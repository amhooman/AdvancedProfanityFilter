import Constants from './lib/constants';
import WebFilter from './webFilter';
import BookmarkletFilter from './bookmarkletFilter';
import { defaultTargetConfig, iOSTargetConfig, safariTargetConfig, supportedSites } from './webAudioSites';
import {
  getElement,
  getElements,
  getGlobalVariable,
  getGlobalVariableFromBackground,
  getParent,
  hmsToSeconds,
  makeBackgroundRequest,
  makeRequest,
  secondsToHMS,
} from './lib/helper';
import Logger from './lib/logger';
import WebConfig from './webConfig';
const logger = new Logger('WebAudio');

export default class WebAudio {
  apfCaptionRuleIds: number[];
  apfCaptionsEnabled: boolean;
  cueRuleIds: number[];
  enabledRuleIds: number[];
  fetching: boolean;
  fillerAudio: HTMLAudioElement;
  fillerAudioPauseHandler: any;
  fillerAudioPlayHandler: any;
  filter: WebFilter | BookmarkletFilter;
  lastFilteredNode: HTMLElement | ChildNode;
  lastFilteredText: string;
  lastProcessedNode: HTMLElement | ChildNode;
  lastProcessedText: string;
  muted: boolean;
  rules: AudioRule[];
  sites: AudioSites;
  siteKey: string;
  supportedPage: boolean;
  supportedCaptions: boolean;
  unmuteTimeout: number;
  volume: number;
  watcherRuleIds: number[];
  wordlistId: number;
  youTube: boolean;
  youTubeAutoSubsMax: number;
  youTubeAutoSubsMin: number;
  youTubeAutoSubsRule: AudioRule;
  youTubeAutoSubsTimeout: number;
  youTubeAutoSubsUnmuteDelay: number;

  static readonly brTagRegExp = new RegExp('<br>', 'i');
  static readonly defaultVideoSelector = 'video';
  static readonly fillerConfig = {
    beep: {
      fileName: 'audio/beep.mp3',
      volume: 0.2,
    },
    crickets: {
      fileName: 'audio/crickets.mp3',
      volume: 0.4,
    },
    static: {
      fileName: 'audio/static.mp3',
      volume: 0.3,
    },
  };
  static readonly textTrackRuleMappings = {
    externalSubTrackLabel: 'label',
    videoCueKind: 'kind',
    videoCueLabel: 'label',
    videoCueLanguage: 'language',
  };

  static getBuildTargetConfig() {
    switch (WebConfig.BUILD.target) {
      case Constants.BUILD_TARGET_IOS:
        return iOSTargetConfig;
      case Constants.BUILD_TARGET_SAFARI:
        return safariTargetConfig;
      default:
        return defaultTargetConfig;
    }
  }

  static removeUnsupportedSites(sites: AudioSites) {
    Object.keys(sites).forEach((siteKey) => {
      // Ensure site rules is an array
      const siteRules = sites[siteKey];
      if (!Array.isArray(siteRules)) {
        sites[siteKey] = [siteRules];
      }

      // Remove any rules with a buildTarget that doesn't match
      sites[siteKey] = sites[siteKey].filter((rule) => {
        return rule.buildTarget == null || rule.buildTarget == WebConfig.BUILD.target;
      });
    });

    // Remove sites without rules
    Object.keys(sites).forEach((siteKey) => {
      if (sites[siteKey].length == 0) {
        delete sites[siteKey];
      }
    });
  }

  static supportedSites(removeUnsupported: boolean = true): AudioSites {
    const buildTargetConfig = WebAudio.getBuildTargetConfig();
    const siteConfig = Object.assign({}, supportedSites, buildTargetConfig.sites);
    buildTargetConfig.disabledSites.forEach((disabledSite) => { delete siteConfig[disabledSite]; });
    if (removeUnsupported) { WebAudio.removeUnsupportedSites(siteConfig); }
    return siteConfig;
  }

  static supportedAndCustomSites(customConfig: AudioSites) {
    const combinedSites = Object.assign({}, WebAudio.supportedSites(false), customConfig);
    WebAudio.removeUnsupportedSites(combinedSites);
    return combinedSites;
  }

  constructor(filter: WebFilter | BookmarkletFilter) {
    this.filter = filter;
    logger.setLevel(this.filter.cfg.loggingLevel);
    this.apfCaptionRuleIds = [];
    this.cueRuleIds = [];
    this.enabledRuleIds = [];
    this.watcherRuleIds = [];
    if (this.filter.extension) { this.fillerAudio = this.initFillerAudio(this.filter.cfg.fillerAudio); }
    this.lastFilteredNode = null;
    this.lastFilteredText = '';
    this.lastProcessedText = '';
    this.muted = false;
    if (
      !filter.cfg.customAudioSites
      || typeof filter.cfg.customAudioSites !== 'object'
    ) {
      filter.cfg.customAudioSites = {};
    }
    this.sites = WebAudio.supportedAndCustomSites(filter.cfg.customAudioSites);
    this.supportedCaptions = false;
    this.volume = 1;
    this.wordlistId = filter.audioWordlistId;
    this.youTubeAutoSubsMax = filter.cfg.youTubeAutoSubsMax * 1000;
    this.youTubeAutoSubsMin = filter.cfg.youTubeAutoSubsMin;
    this.youTubeAutoSubsUnmuteDelay = 0;

    // Setup rules for current site
    this.siteKey = this.getSiteKey();
    this.rules = this.sites[this.siteKey];
    if (this.rules) {
      this.rules.forEach((rule) => { this.initRule(rule); });
      if (this.enabledRuleIds.length > 0) {
        this.supportedPage = true;
        this.initYouTube();
      }

      if (this.apfCaptionRuleIds.length) this.apfCaptionsEnabled = true;
      if (this.cueRuleIds.length) setInterval(this.watchForVideo, 250, this);
    }
  }

  apfCaptionContainer(rule: AudioRule, video?: HTMLVideoElement): HTMLElement {
    let container;
    if (rule.apfCaptionsSelector) container = getElement(rule.apfCaptionsSelector);
    if (!container) { // Fall-back to video's parent
      if (!video) video = getElement(rule.videoSelector) as HTMLVideoElement;
      if (video && video.parentElement) container = video.parentElement;
    }
    return container;
  }

  apfCaptionLine(rule: AudioRule, text: string): HTMLSpanElement {
    const line = document.createElement('span');
    line.classList.add('APF-subtitle-line');
    line.style.background = 'black';
    line.style.color = 'white';
    line.style.fontSize = '3vw';
    line.style.paddingLeft = '4px';
    line.style.paddingRight = '4px';
    line.style.height = '18px';
    line.textContent = text;
    return line;
  }

  apfCaptionLines(rule: AudioRule, lines: HTMLSpanElement[]): HTMLDivElement {
    const apfLines = document.createElement('div');
    apfLines.classList.add('APF-subtitles');
    apfLines.style.bottom = '50px';
    apfLines.style.position = 'absolute';
    apfLines.style.textAlign = 'center';
    apfLines.style.width = '100%';
    lines.forEach((line) => {
      apfLines.appendChild(line);
      apfLines.appendChild(document.createElement('br'));
    });
    return apfLines;
  }

  apfTextTrack(rule: AudioRule, video: HTMLVideoElement): TextTrack {
    if (video) {
      if (video.textTracks.length) {
        const textTrack = Array.from(video.textTracks).find((track) => track.label == rule.apfCuesLabel);
        if (textTrack) return textTrack;
      }

      return video.addTextTrack('captions', rule.apfCuesLabel, rule.apfCuesLabel) as TextTrack;
    }
  }

  buildApfCaptions(rule: AudioRule, captionData: ReplaceTextResult[], container: HTMLElement) {
    if (captionData.length) {
      const captionLines = captionData.map((result) => rule.filterSubtitles && result.modified ? result.filtered : result.original);
      const apfLines = captionLines.map((text) => this.apfCaptionLine(rule, text));
      const apfCaptions = this.apfCaptionLines(rule, apfLines);
      container.appendChild(apfCaptions);
    }
  }

  clean(subtitleContainer, ruleIndex = 0): void {
    const rule = this.rules[ruleIndex];
    if (rule.mode === 'watcher') { return; } // If this is for a watcher rule, leave the text alone

    // Always hide captions if using APF Captions (requires displaySelector)
    if (rule.apfCaptions && rule.displaySelector) this.hideSubtitles(rule);

    let filtered = false;
    const captionData = [];

    if (subtitleContainer.nodeName && subtitleContainer.nodeName === '#text' && subtitleContainer.parentElement) {
      subtitleContainer = subtitleContainer.parentElement;
    }
    const subtitles = rule.subtitleSelector && subtitleContainer.querySelectorAll ? subtitleContainer.querySelectorAll(rule.subtitleSelector) : [subtitleContainer];
    if (subtitles.length === 0) { return; }

    // Process subtitles
    subtitles.forEach((subtitle) => {
      // innerText handles line feeds/spacing better, but is not available to #text nodes
      const textMethod = subtitle.nodeName === '#text' ? 'textContent' : 'innerText';
      if (
        rule.convertBreaks === true
        && subtitle.nodeName !== '#text'
        && !WebAudio.brTagRegExp.test(subtitle[textMethod])
        && WebAudio.brTagRegExp.test(subtitle.innerHTML)
      ) {
        if (subtitle.style.whiteSpace !== 'pre') { subtitle.style.whiteSpace = 'pre'; }
        subtitle.textContent = subtitle.innerHTML.replace(WebAudio.brTagRegExp, '\n');
      }
      const result = this.replaceTextResult(subtitle[textMethod]);
      if (result.modified) {
        filtered = true;
        this.mute(rule); // Mute the audio if we haven't already

        if (rule.filterSubtitles && !rule.apfCaptions) {
          if (rule.preserveWhiteSpace && subtitle.style.whiteSpace !== 'pre') { subtitle.style.whiteSpace = 'pre'; }
          if (rule.ignoreMutations) { this.filter.stopObserving(); }
          subtitle[textMethod] = result.filtered;
          if (rule.ignoreMutations) { this.filter.startObserving(); }
        }

        this.lastFilteredNode = subtitle;
        this.lastFilteredText = subtitle[textMethod];
      }

      if (rule.apfCaptions) {
        for (const line of this.splitReplaceTextResultsOnNewlines(result)) captionData.push(line);
      }

      // Final check to see if we already filtered this text
      // Reason: Hide/show for Funimation (ignoreMutations didn't fix the issue, but no issue if filterSubtitles = false)
      if (!filtered && this.lastFilteredNode == subtitle && this.lastFilteredText == subtitle[textMethod]) {
        filtered = true;
      }

      this.lastProcessedNode = subtitle;
    });

    // When captions/subtitles are spread across multiple mutations, check to see if a filtered node is still present
    if (!filtered) {
      if (this.lastFilteredNode && document.body.contains(this.lastFilteredNode) && this.lastFilteredNode.textContent === this.lastFilteredText) {
        filtered = true;
      }
    }

    // Handle hiding/showing caption text
    const shouldBeShown = this.subtitlesShouldBeShown(rule, filtered);
    if (rule.apfCaptions) {
      this.displayApfCaptions(rule, captionData, shouldBeShown);
    } else {
      shouldBeShown ? this.showSubtitles(rule, subtitles) : this.hideSubtitles(rule, subtitles);
    }
  }

  cleanYouTubeAutoSubs(node): void {
    // Found a new word, clear the max timeout
    if (this.youTubeAutoSubsTimeout != null) {
      clearTimeout(this.youTubeAutoSubsTimeout);
      this.youTubeAutoSubsTimeout = null;
    }

    const result = this.replaceTextResult(node.textContent);
    if (result.modified) {
      if (this.youTubeAutoSubsRule.filterSubtitles) { node.textContent = result.filtered; }
      this.mute(this.youTubeAutoSubsRule);
      this.youTubeAutoSubsUnmuteDelay = null;
      this.filter.updateCounterBadge();

      // Set a timer to unmute if a max time was specified
      if (this.youTubeAutoSubsMax) {
        this.youTubeAutoSubsTimeout = window.setTimeout(this.youTubeAutoSubsMuteTimeout, this.youTubeAutoSubsMax, this);
      }
    } else {
      if (this.muted) {
        if (this.youTubeAutoSubsMin > 0) {
          const currentTime = document.getElementsByTagName(WebAudio.defaultVideoSelector)[0].currentTime;
          if (this.youTubeAutoSubsUnmuteDelay == null) { // Start tracking youTubeAutoSubsUnmuteDelay when next unfiltered word is found
            this.youTubeAutoSubsUnmuteDelay = currentTime;
          } else {
            if (currentTime < this.youTubeAutoSubsUnmuteDelay) { this.youTubeAutoSubsUnmuteDelay = 0; } // Reset youTubeAutoSubsUnmuteDelay if video reversed
            if (currentTime > (this.youTubeAutoSubsUnmuteDelay + this.youTubeAutoSubsMin)) { // Unmute if its been long enough
              this.unmute(this.youTubeAutoSubsRule);
            }
          }
        } else { // Unmute immediately if youTubeAutoSubsMin = 0
          this.unmute(this.youTubeAutoSubsRule);
        }
      }
    }

    // Hide YouTube auto text unless show all subtitles is set
    if (this.filter.cfg.showSubtitles !== Constants.SHOW_SUBTITLES.ALL) {
      const container = document.querySelector('div.ytp-caption-window-rollup span.captions-text') as HTMLElement;
      if (container.style.display == 'block') {
        container.style.display = 'none';
      }
    }
  }

  clearUnmuteTimeout(rule: AudioRule) {
    if (rule.unmuteDelay && this.unmuteTimeout != null) {
      clearTimeout(this.unmuteTimeout);
      this.unmuteTimeout = null;
    }
  }

  cuesIncludingText(cues: FilteredVTTCue[], text: string, prop = 'text') {
    return cues.filter((cue) => {
      return text.includes(cue[prop]);
    });
  }

  cuesInTimeRange(cues: FilteredVTTCue[], startTime: number, rangeEnd: number, padding = 0) {
    return cues.filter((cue) => {
      return cue.startTime >= (startTime - padding) && cue.endTime <= (rangeEnd + padding);
    });
  }

  delayedUnmute(instance: WebAudio, rule: AudioRule) {
    const delayed = true;
    instance.unmute(rule, null, delayed);
    this.unmuteTimeout = null;
  }

  displayApfCaptions(rule: AudioRule, captionData: ReplaceTextResult[], shouldBeShown: boolean) {
    const container = this.apfCaptionContainer(rule);
    if (container) {
      this.removeApfCaptions(rule, container);
      if (shouldBeShown) this.buildApfCaptions(rule, captionData, container);
    } else {
      logger.warn('Failed to find APF Captions container.');
    }
  }

  fillerAudioHandlePause() {
    this.fillerAudio.pause();
  }

  fillerAudioHandlePlay() {
    if (this.muted) {
      this.fillerAudio.play();
    }
  }

  getSiteKey(): string {
    if (this.sites.hasOwnProperty(this.filter.hostname)) {
      return this.filter.hostname;
    } else if (
      this.filter.iframe
      && this.filter.iframe.hostname
      && this.sites.hasOwnProperty(this.filter.iframe.hostname)
    ) {
      return this.filter.iframe.hostname;
    }

    return '';
  }

  // Priority (requires cues): [overrideKey], label, language, kind (prefer caption/subtitle), order
  getVideoTextTrack(textTracks, rule, overrideKey?: string): TextTrack {
    let bestIndex = 0;
    let bestScore = 0;
    let foundCues = false; // Return the first match with cues if no other matches are found
    let perfectScore = 0;
    if (overrideKey && rule[overrideKey]) { perfectScore += 1000; }
    if (rule.videoCueLabel) { perfectScore += 100; }
    if (rule.videoCueLanguage) { perfectScore += 10; }
    if (rule.videoCueKind) { perfectScore += 1; } // Add one, because we will default to 'captions'/'subtitles'

    for (let i = 0; i < textTracks.length; i++) {
      const textTrack = textTracks[i];
      if (!textTrack.cues || textTrack.cues.length === 0) { continue; }
      if (rule.videoCueRequireShowing && textTrack.mode !== 'showing') { continue; }

      let currentScore = 0;
      if (overrideKey && rule[overrideKey] && this.textTrackKeyTest(textTrack, WebAudio.textTrackRuleMappings[overrideKey], rule[overrideKey])) { currentScore += 1000; }
      if (rule.videoCueLabel && this.textTrackKeyTest(textTrack, WebAudio.textTrackRuleMappings.videoCueLabel, rule.videoCueLabel)) { currentScore += 100; }
      if (rule.videoCueLanguage && this.textTrackKeyTest(textTrack, WebAudio.textTrackRuleMappings.videoCueLanguage, rule.videoCueLanguage)) { currentScore += 10; }
      if (rule.videoCueKind) {
        if (this.textTrackKeyTest(textTrack, WebAudio.textTrackRuleMappings.videoCueKind, rule.videoCueKind)) { currentScore += 1; }
      } else {
        if (
          this.textTrackKeyTest(textTrack, WebAudio.textTrackRuleMappings.videoCueKind, 'captions')
          || this.textTrackKeyTest(textTrack, WebAudio.textTrackRuleMappings.videoCueKind, 'subtitles')
        ) { currentScore += 1; }
      }

      if (currentScore === perfectScore) { return textTrack; }
      if (currentScore > bestScore || !foundCues) {
        bestScore = currentScore;
        bestIndex = i;
        foundCues = true;
      }
    }

    if (foundCues) { return textTracks[bestIndex]; }
  }

  // Some sites ignore textTrack.mode = 'hidden' and will still show captions
  // This is a fallback (not preferred) method that can be used for hiding the cues
  hideCue(rule: AudioRule, cue: FilteredVTTCue) {
    cue.text = '';
    cue.position = 100;
    cue.size = 0;
  }

  hideSubtitles(rule: AudioRule, subtitles?) {
    if (rule.displayVisibility && rule._displayElement) {
      // TODO: Only tested with Watcher: HBO Max. This may be a much better solution
      rule._displayElement.style.visibility = 'hidden';
    } else if (rule.displaySelector) {
      const root = rule.rootNode && subtitles && subtitles[0] ? subtitles[0].getRootNode() : document;
      if (root) {
        let container = getElement(rule.displaySelector, root);
        if (container && rule.displaySelectorParents) container = getParent(container, rule.displaySelectorParents);
        if (container) {
          // Save the original display style if none was included in the rule
          if (
            rule.displayShow === ''
            && container.style.display !== ''
            && container.style.display !== rule.displayHide
          ) {
            rule.displayShow = container.style.display;
          }

          container.style.setProperty('display', rule.displayHide); // , 'important');
        }
      }
    } else if (subtitles) {
      subtitles.forEach((subtitle) => {
        subtitle.innerText = '';
        if (rule.removeSubtitleSpacing && subtitle.style) {
          if (subtitle.style.padding) { subtitle.style.padding = 0; }
          if (subtitle.style.margin) { subtitle.style.margin = 0; }
        }
      });
    }
  }

  initCueRule(rule: AudioRule) {
    if (rule.apfCaptions === true) rule.videoCueHideCues = true;
    if (rule.videoCueRequireShowing === undefined) rule.videoCueRequireShowing = this.filter.cfg.muteCueRequireShowing;
    if (rule.externalSub) {
      if (rule.externalSubTrackMode === undefined) rule.externalSubTrackMode = 'showing';
      if (rule.externalSubURLKey === undefined) rule.externalSubURLKey = 'url';
      if (rule.externalSubFormatKey === undefined) rule.externalSubFormatKey = 'format';
      if (rule.externalSubTrackLabel === undefined) rule.externalSubTrackLabel = 'APF';
    }
  }

  initDisplaySelector(rule: AudioRule) {
    if (rule.displaySelector !== undefined) {
      if (rule.displayHide === undefined) rule.displayHide = 'none';
      if (rule.displayShow === undefined) rule.displayShow = '';
    }
  }

  initDynamicRule(rule: AudioRule) {
    rule._dynamic = true;
    if (rule.dynamicTargetMode == undefined) rule.disabled == true;
  }

  initElementChildRule(rule: AudioRule) {
    if (!rule.parentSelector && !rule.parentSelectorAll) rule.disabled = true;
    if (rule.apfCaptions) {
      if (rule.displaySelector === undefined) rule.disabled = true;
    }
  }

  initElementRule(rule: AudioRule) {
    if (rule.apfCaptions) {
      if (rule.displaySelector === undefined) rule.disabled = true;
    }
  }

  initFillerAudio(name: string = ''): HTMLAudioElement {
    const fillerConfig = WebAudio.fillerConfig[name];
    if (fillerConfig) {
      const url = chrome.runtime.getURL(fillerConfig.fileName);
      const audioFiller = new Audio();
      audioFiller.src = url;
      audioFiller.loop = true;
      if (fillerConfig.volume) audioFiller.volume = fillerConfig.volume;
      if (fillerConfig.loopAfter) {
        audioFiller.ontimeupdate = () => {
          if (audioFiller.currentTime > fillerConfig.loopAfter) {
            audioFiller.currentTime = 0;
          }
        };
      }
      this.fillerAudioPauseHandler = this.fillerAudioHandlePause.bind(this);
      this.fillerAudioPlayHandler = this.fillerAudioHandlePlay.bind(this);
      return audioFiller;
    }
  }

  initRule(rule: AudioRule) {
    const ruleId = this.rules.indexOf(rule);
    if (
      rule.mode === undefined
      || ((rule.mode == 'element' || rule.mode == 'elementChild') && !rule.tagName)
      // Skip this rule if it doesn't apply to the current page
      || (rule.iframe === true && this.filter.iframe == null)
      || (rule.iframe === false && this.filter.iframe != null)
    ) {
      rule.disabled = true;
    }

    if (rule.disabled) {
      logger.info('Audio rule disabled', rule);
    } else {
      // Setup rule defaults
      if (rule.filterSubtitles == null) rule.filterSubtitles = true;
      if (this.filter.filterText == false) rule.filterSubtitles = false;
      if (rule.videoSelector === undefined) rule.videoSelector = WebAudio.defaultVideoSelector;
      this.initDisplaySelector(rule);

      // Allow rules to override global settings
      if (rule.muteMethod == null) rule.muteMethod = this.filter.cfg.muteMethod;
      if (rule.showSubtitles == null) rule.showSubtitles = this.filter.cfg.showSubtitles;

      // Ensure proper rule values
      if (rule.tagName != null && rule.tagName != '#text') rule.tagName = rule.tagName.toUpperCase();

      switch (rule.mode) {
        case 'cue':
          this.initCueRule(rule);
          if (!rule.disabled) this.cueRuleIds.push(ruleId);
          break;
        case 'dynamic':
          this.initDynamicRule(rule);
          break;
        case 'elementChild':
          this.initElementChildRule(rule);
          break;
        case 'element':
          this.initElementRule(rule);
          break;
        case 'text':
          this.initTextRule(rule);
          break;
        case 'watcher':
          this.initWatcherRule(rule);
          if (!rule.disabled) this.watcherRuleIds.push(ruleId);
          break;
        case 'ytauto':
          // This rule doesn't run like other rules, and is marked as disabled
          rule.disabled = true;
          break;
      }

      if (rule.disabled) {
        if (rule.mode != 'ytauto') logger.info('Audio rule disabled during initialization', rule);
      } else {
        this.enabledRuleIds.push(ruleId);
        if (rule.apfCaptions) this.apfCaptionRuleIds.push(ruleId);

        if (rule.mode == 'watcher') {
          if (rule.toCue) {
            setInterval(this.watcherToCue, rule.checkInterval, this, ruleId);
          } else {
            setInterval(this.watcher, rule.checkInterval, this, ruleId);
          }
        }
      }
    }
  }

  initTextRule(rule: AudioRule) {
    rule.tagName = '#text';
    if (rule.simpleUnmute === undefined) rule.simpleUnmute = true;
  }

  initWatcherRule(rule: AudioRule) {
    if (rule.apfCuesLabel === undefined) rule.apfCuesLabel = 'APF-Cues';
    if (rule.checkInterval === undefined) rule.checkInterval = 20;
    if (rule.ignoreMutations === undefined) rule.ignoreMutations = true;
    if (rule.simpleUnmute === undefined) rule.simpleUnmute = true;
  }

  initYouTube() {
    if (['m.youtube.com', 'tv.youtube.com', 'www.youtube.com'].includes(this.siteKey)) {
      this.youTube = true;

      // Issue 251: YouTube is now filtering words out of auto-generated captions/subtitles
      if (this.filter.cfg.youTubeAutoMatchCensored) {
        const youTubeAutoCensor = '\\[\\s__\\s\\]';
        const lists = this.wordlistId === Constants.ALL_WORDS_WORDLIST_ID ? [] : [this.wordlistId];
        const youTubeAutoCensorOptions: WordOptions = {
          lists: lists,
          matchMethod: Constants.MATCH_METHODS.REGEX,
          repeat: Constants.FALSE,
          separators: Constants.FALSE,
          sub: '[ _ ]',
        };
        this.filter.cfg.addWord(youTubeAutoCensor, youTubeAutoCensorOptions);
      }

      // Setup rule for YouTube Auto Subs
      this.youTubeAutoSubsRule = { mode: 'ytauto' } as AudioRule;
      this.initRule(this.youTubeAutoSubsRule);
    }
  }

  mute(rule?: AudioRule, video?: HTMLVideoElement): void {
    if (!this.muted) {
      this.muted = true;
      if (this.filter.cfg.collectStats) {
        this.filter.stats.mutes++;
      }

      switch (rule.muteMethod) {
        case Constants.MUTE_METHODS.TAB:
          chrome.runtime.sendMessage(this.filter.buildMessage(Constants.MESSAGING.BACKGROUND, { mute: true }));
          break;
        case Constants.MUTE_METHODS.VIDEO_MUTE:
          if (!video) { video = getElement(rule.videoSelector) as HTMLVideoElement; }
          if (video && !video.muted) { video.muted = true; }
          if (this.fillerAudio) { this.playFillerAudio(video); }
          break;
        case Constants.MUTE_METHODS.VIDEO_VOLUME:
          if (!video) { video = getElement(rule.videoSelector) as HTMLVideoElement; }
          if (video && video.volume != null) {
            this.volume = video.volume; // Save original volume
            video.volume = 0;
          }
          if (this.fillerAudio) { this.playFillerAudio(video); }
          break;
      }
      logger.debugTime('mute()');
    }

    // If we called mute and there is a delayedUnmute planned, clear it
    if (rule && rule.unmuteDelay && this.unmuteTimeout) { this.clearUnmuteTimeout(rule); }
  }

  newCue(start, end, text, options: ParsedSubOptions = {}): VTTCue {
    try {
      const startSeconds = typeof start === 'string' ? hmsToSeconds(start) : start;
      const endSeconds = typeof end === 'string' ? hmsToSeconds(end) : end;
      const cue = new VTTCue(startSeconds, endSeconds, text);
      if (options.align) { cue.align = options.align; }
      if (options.line) { cue.line = this.parseLineAndPositionSetting(options.line); }
      if (options.position) { cue.position = this.parseLineAndPositionSetting(options.position); }
      return cue;
    } catch (err) {
      logger.error(`Failed to add cue: ( start: ${start}, end: ${end}, text: ${text} )`, err);
    }
  }

  newTextTrack(rule: AudioRule, video: HTMLVideoElement, cues: VTTCue[]): TextTrack {
    if (video.textTracks) {
      const track = video.addTextTrack('captions', rule.externalSubTrackLabel, rule.videoCueLanguage) as TextTrack;
      track.mode = rule.externalSubTrackMode;
      for (let i = 0; i < cues.length; i++) {
        track.addCue(cues[i]);
      }
      return track;
    }
  }

  parseLineAndPositionSetting(setting: string): LineAndPositionSetting {
    if (typeof setting == 'string' && setting != '') {
      if (setting == 'auto') {
        return 'auto';
      } else {
        return parseInt(setting);
      }
    }
  }

  parseSRT(srt): VTTCue[] {
    const lines = srt.trim().replace('\r\n', '\n').split(/[\r\n]/).map((line) => line.trim());
    const cues: VTTCue[] = [];
    let start = null;
    let end = null;
    let text = null;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].indexOf('-->') >= 0) {
        const splitted = lines[i].split(/[ \t]+-->[ \t]+/);
        if (splitted.length != 2) {
          throw new Error(`Error when splitting "-->": ${lines[i]}.`);
        }
        start = splitted[0];
        end = splitted[1];
      } else if (lines[i] == '') {
        if (start && end) {
          const cue = this.newCue(start, end, text);
          cues.push(cue);
          start = null;
          end = null;
          text = null;
        }
      } else if (start && end) {
        if (text == null) {
          text = lines[i];
        } else {
          text += '\n' + lines[i];
        }
      }
    }
    if (start && end) {
      const cue = this.newCue(start, end, text);
      cues.push(cue);
    }
    return cues;
  }

  parseSSA(ssa: string): VTTCue[] {
    const cues: VTTCue[] = [];
    let endIndex, startIndex, textIndex;
    let foundEvents = false;

    const lines = ssa.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!foundEvents) {
        if (lines[i].match(/^\[Events\]/i)) { foundEvents = true; }
        continue;
      }

      if (lines[i].match(/^format:/i)) {
        const format = lines[i].trim().split(',');
        endIndex = format.indexOf('End');
        startIndex = format.indexOf('Start');
        textIndex = format.indexOf('Text');
      } else if (lines[i].match(/^dialogue:/i)) {
        const line = lines[i].trim().split(',');
        const start = line[startIndex];
        const end = line[endIndex];
        const cleanText = line.slice(textIndex).join(',').replace(/\{\\\w.+?\}/g, '').split('\\N').reverse(); // Cleanup formatting and convert newlines
        for (let j = 0; j < cleanText.length; j++) {
          cues.push(this.newCue(start, end, cleanText[j]));
        }
      }
    }
    return cues;
  }

  parseVTT(input: string): VTTCue[] {
    const cues: VTTCue[] = [];
    const lines = input.split('\n');
    const separator = new RegExp('\\s-->\\s');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.match(separator)) { // Timestamp [& option] line
        const parts = line.replace(separator, ' ').split(' ');
        let [start, end, ...extraOptions] = parts;
        start = start.replace(',', '.');
        end = end.replace(',', '.');
        const options: ParsedSubOptions = extraOptions.map((o) => o.split(':')).reduce((acc, cur) => {acc[cur[0]] = cur[1]; return acc;}, {});

        // Get text
        const prevLine = lines[i-1].trim();
        const nextLine = lines[i+1].trim();
        const textStartRegex = new RegExp(`^<[cs]\\.${prevLine}>`);
        const textEndRegex = new RegExp('<\/[cs]>$');
        let text;
        if (nextLine.match(textStartRegex)) {
          text = nextLine.replace(textStartRegex, '').replace(textEndRegex, '');
        } else {
          text = nextLine;
        }

        // Handle the case when there are multiple cues that should be shown concurrently
        // The first line of the entry could look like "Caption-C8_1", and the subsequent entry would be "Caption-C8_2"
        if (prevLine && !prevLine.match(/_1$/)) {
          const previousCue = cues[cues.length-1];
          // If they share an endTime with the previous cue, but startTimes are different, make them match
          if (previousCue.startTime != hmsToSeconds(start) && previousCue.endTime == hmsToSeconds(end)) {
            start = secondsToHMS(previousCue.startTime);
          }
        }

        const cue = this.newCue(start, end, text, options);

        // Concurrent cues seem to be displayed backwards, so we'll reverse them: [a,b,c] -> [c,b,a]
        if (prevLine && !prevLine.match(/_1$/)) {
          const concurrentNumber = parseInt(prevLine.match(/_([2-9])$/)[1]);
          const firstConcurrentCueIndex = (cues.length - concurrentNumber) + 1; // Find the first concurrent index
          cues.splice(firstConcurrentCueIndex, 0, cue);
        } else {
          cues.push(cue);
        }

        i++; // Skip the next line because we already processed the text
      }
    }
    return cues;
  }

  playFillerAudio(video: HTMLVideoElement) {
    if (this.playing(video)) {
      this.fillerAudio.play();
      video.addEventListener('pause', this.fillerAudioPauseHandler);
      video.addEventListener('play', this.fillerAudioPlayHandler);
    }
  }

  playing(video: HTMLVideoElement): boolean {
    return !!(video && video.currentTime > 0 && !video.paused && !video.ended && video.readyState > 2);
  }

  processCues(cues: FilteredVTTCue[], rule: AudioRule) {
    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i];
      if (cue.hasOwnProperty('filtered')) { continue; }

      if (rule.videoCueSync) {
        cue.startTime += rule.videoCueSync;
        cue.endTime += rule.videoCueSync;
      }

      const result = this.replaceTextResult(cue.text);
      cue.originalText = cue.text;
      cue.filteredText = result.filtered;
      if (result.modified) {
        cue.filtered = true;
        if (rule.filterSubtitles && !rule.apfCaptions) { cue.text = result.filtered; }
      } else {
        cue.filtered = false;
      }
    }
  }

  async processExternalSub(video: HTMLVideoElement, rule) {
    const textTrack = this.getVideoTextTrack(video.textTracks, rule, 'externalSubTrackLabel');
    if (!this.fetching && !textTrack) {
      try {
        let subsData;
        if (WebConfig.BUILD.manifestVersion == 3) {
          subsData = await getGlobalVariableFromBackground(rule.externalSubVar);
        } else {
          subsData = getGlobalVariable(rule.externalSubVar);
        }

        if (Array.isArray(subsData)) {
          const found = subsData.find((subtitle) => subtitle.language === rule.videoCueLanguage);
          if (!found) { throw new Error(`Failed to find subtitle for language: ${rule.videoCueLanguage}.`); }
          this.fetching = true;
          let subs;
          if (WebConfig.BUILD.target == 'bookmarklet') {
            subs = await makeRequest(found[rule.externalSubURLKey], 'GET') as string;
          } else {
            subs = await makeBackgroundRequest(found[rule.externalSubURLKey], 'GET') as string;
          }
          if (typeof subs == 'string' && subs) {
            let parsedCues;
            switch (found[rule.externalSubFormatKey]) {
              case 'ass': parsedCues = this.parseSSA(subs); break;
              case 'srt': parsedCues = this.parseSRT(subs); break;
              case 'vtt': parsedCues = this.parseVTT(subs); break;
              default:
                throw new Error(`Unsupported subtitle type: ${found[rule.externalSubFormatKey]}.`);
            }
            if (parsedCues) {
              const track = this.newTextTrack(rule, video, parsedCues);
              const cues = track.cues as any as FilteredVTTCue[];
              this.processCues(cues, rule);
              this.fetching = false;

              // Hide old captions/subtitles
              if (rule.displaySelector) {
                const oldSubtitlesContainer = document.querySelector(rule.displaySelector) as HTMLElement;
                if (oldSubtitlesContainer) { oldSubtitlesContainer.style.display = 'none'; }
              }
            }
          } else {
            throw new Error(`Failed to download external subtitles from '${found[rule.externalSubURLKey]}'.`);
          }
        } else {
          throw new Error(`Failed to find subtitle variable: ${rule.externalSubVar}.`);
        }
      } catch (err) {
        logger.error(`Error using external subtitles for ${this.siteKey}.`, err);
      }
    }
  }

  processWatcherCaptions(rule, captions, data) {
    const initialCall = data.initialCall; // Check if this is the first call
    if (initialCall) {
      // Don't process the same filter again
      if (this.lastProcessedText && this.lastProcessedText === captions.textContent) {
        data.skipped = true;
        return false;
      } else { // These are new captions, unmute if muted
        this.unmute(rule);
        this.lastProcessedText = '';
      }

      data.initialCall = false;
    }

    if (captions.hasChildNodes()) {
      captions.childNodes.forEach((child) => {
        this.processWatcherCaptions(rule, child, data);
      });
    } else { // Process child
      // innerText handles line feeds/spacing better, but is not available to #text nodes
      const textMethod = (captions && captions.nodeName) === '#text' ? 'textContent' : 'innerText';

      // Don't process empty/whitespace nodes
      if (captions[textMethod] && captions[textMethod].trim()) {
        const result = this.replaceTextResult(captions[textMethod]);
        if (result.modified) {
          this.mute(rule);
          data.filtered = true;
          if (rule.filterSubtitles && !rule.apfCaptions) { captions[textMethod] = result.filtered; }
        }
        data.textResults.push(result);
      }
    }

    if (initialCall) { this.lastProcessedText = captions.textContent; }
  }

  processWatcherCaptionsArray(rule: AudioRule, captions: HTMLElement[], data: WatcherData) {
    const originalText = captions.map((caption) => caption.textContent).join(' ');

    // Don't process the same filter again
    if (this.lastProcessedText && this.lastProcessedText === originalText) {
      data.skipped = true;
      return false;
    } else { // These are new captions, unmute if muted
      this.unmute(rule);
      this.lastProcessedText = '';
    }

    captions.forEach((caption) => {
      // Don't process empty/whitespace nodes
      if (caption.textContent && caption.textContent.trim()) {
        const result = this.replaceTextResult(caption.textContent);
        if (result.modified) {
          this.mute(rule);
          data.filtered = true;
          if (rule.filterSubtitles && !rule.apfCaptions) { caption.textContent = result.filtered; }
        }
        data.textResults.push(result);
      }
    });

    this.lastProcessedText = captions.map((caption) => caption.textContent).join(' ');
  }

  removeApfCaptions(rule: AudioRule, container?: HTMLElement) {
    if (!container) container = this.apfCaptionContainer(rule);
    if (container) {
      const oldLines = getElement('div.APF-subtitles', container);
      if (oldLines) oldLines.remove();
    }
  }

  replaceTextResult(string: string, wordlistId: number = this.wordlistId, statsType: string | null = Constants.STATS_TYPE_AUDIO) {
    return this.filter.replaceTextResult(string, wordlistId, statsType);
  }

  showSubtitles(rule, subtitles?) {
    if (rule.displayVisibility && rule._displayElement) {
      // TODO: Only tested with Watcher: HBO Max. This may be a much better solution
      rule._displayElement.style.visibility = 'visible';
    } else if (rule.displaySelector) {
      const root = rule.rootNode && subtitles && subtitles[0] ? subtitles[0].getRootNode() : document;
      if (root) {
        let container = getElement(rule.displaySelector, root);
        if (container && rule.displaySelectorParents) container = getParent(container, rule.displaySelectorParents);
        if (container) container.style.setProperty('display', rule.displayShow);
      }
    }
  }

  splitReplaceTextResultsOnNewlines(result: ReplaceTextResult) {
    const originalLines = result.original.split('\n');
    const filteredLines = result.filtered.split('\n');
    if (originalLines.length === 1 || originalLines.length !== filteredLines.length) return [result];

    const lines = [];
    for (let i = 0; i < originalLines.length; i++) {
      const originalLine = originalLines[i];
      const filteredLine = filteredLines[i];
      const lineModified = result.modified && originalLine != filteredLine;
      lines.push({ filtered: filteredLine, modified: lineModified, original: originalLine });
    }
    return lines;
  }

  stopFillerAudio() {
    this.fillerAudio.pause();
    this.fillerAudio.currentTime = 0;
  }

  subtitlesShouldBeShown(rule, filtered: boolean = false): boolean {
    switch (rule.showSubtitles) {
      case Constants.SHOW_SUBTITLES.ALL: return true;
      case Constants.SHOW_SUBTITLES.FILTERED: return filtered;
      case Constants.SHOW_SUBTITLES.UNFILTERED: return !filtered;
      case Constants.SHOW_SUBTITLES.NONE: return false;
    }
  }

  supportedCaptionsFound(found = true, forceUpdate = false) {
    if (!this.filter.extension || (!forceUpdate && found == this.supportedCaptions)) return;

    const message: Message = { destination: Constants.MESSAGING.BACKGROUND, source: Constants.MESSAGING.CONTEXT, forceUpdate: forceUpdate };

    this.supportedCaptions = found;
    if (found) {
      message.status = Constants.STATUS.CAPTIONS;
      chrome.runtime.sendMessage(message);
      logger.info('Supported captions found');
    } else {
      message.status = Constants.STATUS.MUTE_PAGE;
      chrome.runtime.sendMessage(message);
      logger.info('Watching for supported captions');
    }
  }

  // [BETA]
  // This isn't being actively used now
  supportedDynamicNode(node: HTMLElement, rule: AudioRule) {
    // HBO Max: When playing a video, this node gets added, but doesn't include any context. Grabbing classList and then start watching.
    if (node.textContent === rule.dynamicTextKey) {
      rule.mode = rule.dynamicTargetMode;
      // TODO: Only working for HBO Max right now
      rule.parentSelectorAll = `${node.tagName.toLowerCase()}.${Array.from(node.classList).join('.')} ${rule.parentSelectorAll}`;
      this.initRule(rule);
    }
  }

  supportedElementNode(node: HTMLElement, rule: AudioRule) {
    if (node.nodeName == rule.tagName) {
      if (rule.className && (!node.className || !node.classList.contains(rule.className))) return false;
      if (rule.dataPropPresent && (!node.dataset || !node.dataset.hasOwnProperty(rule.dataPropPresent))) return false;
      if (rule.hasChildrenElements && (typeof node.childElementCount !== 'number' || node.childElementCount == 0)) return false;
      if (rule.subtitleSelector && (typeof node.querySelector !== 'function' || !node.querySelector(rule.subtitleSelector))) return false;
      if (rule.containsSelector && (typeof node.querySelector !== 'function' || !node.querySelector(rule.containsSelector))) return false;
      return true;
    }

    return false;
  }

  supportedElementChildNode(node: HTMLElement, rule: AudioRule) {
    if (node.nodeName === rule.tagName) {
      const root = rule.rootNode ? node.getRootNode() : document as any;
      if (root) {
        if (rule.parentSelector) {
          const parent = root.querySelector(rule.parentSelector);
          if (parent && (parent == node || parent.contains(node))) return true;
        } else {
          const parents = root.querySelectorAll(rule.parentSelectorAll);
          for (let j = 0; j < parents.length; j++) {
            if (parents[j].contains(node)) return true;
          }
        }
      }
    }

    return false;
  }

  // Checks if a node is a supported audio node.
  // Returns rule id upon first match, otherwise returns false
  supportedNode(node) {
    for (let i = 0; i < this.enabledRuleIds.length; i++) {
      const ruleId = this.enabledRuleIds[i];
      const rule = this.rules[ruleId];
      let supported = false;

      switch (rule.mode) {
        case 'element':
          supported = this.supportedElementNode(node, rule); break;
        case 'elementChild':
          supported = this.supportedElementChildNode(node, rule); break;
        case 'text':
          supported = this.supportedTextNode(node, rule); break;
        case 'watcher':
          supported = this.supportedWatcherNode(node, rule); break;
        case 'dynamic':
          this.supportedDynamicNode(node, rule); break;
      }

      if (supported) {
        this.supportedCaptionsFound();
        return ruleId;
      }
    }

    // No matching rule was found
    return false;
  }

  supportedTextNode(node: HTMLElement, rule: AudioRule) {
    if (node.nodeName === rule.tagName) {
      const parent = document.querySelector(rule.parentSelector);
      if (parent && parent.contains(node)) return true;
    }

    return false;
  }

  supportedWatcherNode(node: HTMLElement, rule: AudioRule) {
    if (rule.subtitleSelector != null && node.parentElement && node.parentElement == getElement(rule.subtitleSelector)) {
      return true;
    }
    if (rule.parentSelector != null) {
      const parent = getElement(rule.parentSelector);
      if (parent && parent.contains(node)) return true;
    }

    return false;
  }

  textTrackKeyTest(textTrack: TextTrack, key: string, value: string) {
    return (textTrack[key] && value && textTrack[key] === value);
  }

  unmute(rule?: AudioRule, video?: HTMLVideoElement, delayed: boolean = false): void {
    if (this.muted) {
      // If we haven't already delayed unmute and we should (rule.unmuteDelay), set the timeout
      if (!delayed && rule && rule.unmuteDelay >= 0) {
        // If unmute is called after an unmute has been scheduled, remove the older one and schedule a new unmute
        if (this.unmuteTimeout == null) { this.clearUnmuteTimeout(rule); }
        this.unmuteTimeout = window.setTimeout(this.delayedUnmute, rule.unmuteDelay, this, rule);
        return;
      }

      this.muted = false;
      switch (rule.muteMethod) {
        case Constants.MUTE_METHODS.TAB:
          chrome.runtime.sendMessage(this.filter.buildMessage(Constants.MESSAGING.BACKGROUND, { mute: false }));
          break;
        case Constants.MUTE_METHODS.VIDEO_MUTE:
          if (this.fillerAudio) { this.stopFillerAudio(); }
          if (!video) { video = getElement(rule.videoSelector) as HTMLVideoElement; }
          if (video && video.muted) { video.muted = false; }
          break;
        case Constants.MUTE_METHODS.VIDEO_VOLUME:
          if (this.fillerAudio) { this.stopFillerAudio(); }
          if (!video) { video = getElement(rule.videoSelector) as HTMLVideoElement; }
          if (video && video.volume != null) {
            video.volume = this.volume;
          }
          break;
      }
      logger.debugTime('unmute()');
    }
  }

  watcher(instance: WebAudio, ruleId = 0) {
    const rule = instance.rules[ruleId];
    const video = getElement(rule.videoSelector) as HTMLVideoElement;

    if (video && instance.playing(video)) {
      if (rule.ignoreMutations) { instance.filter.stopObserving(); } // Stop observing when video is playing
      const data: WatcherData = { filtered: false, initialCall: true, textResults: [] };
      let captions;

      // Always hide captions if using APF Captions
      if (rule.apfCaptions && rule.displaySelector) instance.hideSubtitles(rule);

      if (rule.parentSelector) { // Tested on: Amazon
        captions = document.querySelector(rule.parentSelector) as HTMLElement;
        if (captions && captions.textContent && captions.textContent.trim()) {
          instance.processWatcherCaptions(rule, captions, data);
        } else { // If there are no captions/subtitles: unmute and hide
          instance.watcherSimpleUnmute(rule, video);
        }
      } else if (rule.subtitleSelector) {
        captions = Array.from(getElements(rule.subtitleSelector));
        if (captions && captions.length) {
          // TODO: displayVisibility support should be expanded or removed
          if (rule.displayVisibility && (!rule._displayElement || !document.body.contains(rule._displayElement))) {
            rule._displayElement = getParent(captions[0], rule.displayElementLevels);
          }
          instance.processWatcherCaptionsArray(rule, captions, data);
        } else { // If there are no captions/subtitles: unmute and hide
          instance.watcherSimpleUnmute(rule, video);
        }
      }

      if (data.skipped) { return false; }
      instance.supportedCaptionsFound();

      // Hide/show caption/subtitle text
      const shouldBeShown = instance.subtitlesShouldBeShown(rule, data.filtered);

      if (rule.apfCaptions) {
        instance.displayApfCaptions(rule, data.textResults, shouldBeShown);
      } else {
        shouldBeShown ? instance.showSubtitles(rule) : instance.hideSubtitles(rule);
      }

      if (data.filtered) { instance.filter.updateCounterBadge(); }
    } else {
      if (rule.ignoreMutations) { instance.filter.startObserving(); } // Start observing when video is not playing
    }
  }

  watchForVideo(instance: WebAudio) {
    for (let x = 0; x < instance.cueRuleIds.length; x++) {
      const rule = instance.rules[x] as AudioRule;
      const video = getElement(rule.videoSelector) as HTMLVideoElement;
      if (video && video.textTracks && instance.playing(video)) {
        if (rule.externalSub) { instance.processExternalSub(video, rule); }
        const textTrack = instance.getVideoTextTrack(video.textTracks, rule);

        if (textTrack && !textTrack.oncuechange) {
          if (!rule.videoCueHideCues && rule.showSubtitles === Constants.SHOW_SUBTITLES.NONE) { textTrack.mode = 'hidden'; }

          textTrack.oncuechange = () => {
            if (textTrack.activeCues && textTrack.activeCues.length > 0) {
              const activeCues = Array.from(textTrack.activeCues as any as FilteredVTTCue[]);
              const captionData = [] as ReplaceTextResult[];

              // Process cues
              const processed = activeCues.some((activeCue) => activeCue.hasOwnProperty('filtered'));
              if (!processed) {
                const allCues = Array.from(textTrack.cues as any as FilteredVTTCue[]);
                instance.processCues(allCues, rule);
              }

              const filtered = activeCues.some((activeCue) => activeCue.filtered);
              filtered ? instance.mute(rule, video) : instance.unmute(rule, video);
              const shouldBeShown = instance.subtitlesShouldBeShown(rule, filtered);

              for (let i = 0; i < activeCues.length; i++) {
                const activeCue = activeCues[i];
                if (!shouldBeShown && rule.videoCueHideCues) { instance.hideCue(rule, activeCue); }
                if (rule.apfCaptions) {
                  // Cues seem to show up in reverse order
                  captionData.unshift({ filtered: activeCue.filteredText, original: activeCue.originalText, modified: activeCue.filtered });
                }
              }

              if (rule.apfCaptions) instance.displayApfCaptions(rule, captionData, shouldBeShown);
              if (!rule.videoCueHideCues) { textTrack.mode = shouldBeShown ? 'showing' : 'hidden'; }
              if (rule.displaySelector) {
                // Hide original subtitles if using apfCaptions
                rule.apfCaptions || !shouldBeShown ? instance.hideSubtitles(rule) : instance.showSubtitles(rule);
              }
            } else { // No active cues
              instance.unmute(rule, video);

              if (rule.apfCaptions) {
                // Remove APF captions because there are no active cues
                instance.removeApfCaptions(rule);
              }
            }
          };

          // Pre-process all cues after setting oncuechange
          const allCues = Array.from(textTrack.cues as any as FilteredVTTCue[]);
          instance.processCues(allCues, rule);
          instance.supportedCaptionsFound(true);
        }
      }
    }
  }

  watcherSimpleUnmute(rule: AudioRule, video: HTMLVideoElement) {
    this.unmute(rule, video);
    if (rule.showSubtitles > Constants.SHOW_SUBTITLES.ALL) { this.hideSubtitles(rule); }
  }

  // [BETA]
  // This method doesn't currently work when skipping around or seeking backwards
  // NOTE: May want to use the onCueChange event function to handle muting? (cue.filtered, etc.)
  watcherToCue(instance: WebAudio, ruleId = 0) {
    const rule = instance.rules[ruleId];
    const video = getElement(rule.videoSelector) as HTMLVideoElement;

    if (video && instance.playing(video)) {
      if (rule.ignoreMutations) { instance.filter.stopObserving(); } // Stop observing when video is playing
      instance.hideSubtitles(rule); // Always hide captions if using APF Cues
      const textTrack = instance.apfTextTrack(rule, video);
      const currentTime = video.currentTime;
      const data: WatcherData = { filtered: false, initialCall: true, textResults: [] };
      let captions;

      if (rule.subtitleSelector) {
        captions = Array.from(getElements(rule.subtitleSelector));
        if (captions && captions.length) {
          const originalText = captions.map((caption) => caption.textContent).join(' ');

          // Don't process the same filter again
          if (instance.lastProcessedText && instance.lastProcessedText === originalText) {
            data.skipped = true;
            return false;
          } else {
            // NOTE: Attempt to determine if the current captions were already added (seek backwards/re-watching video)
            // Deeper check to see if we've already processed these captions
            // if (textTrack && textTrack.activeCues && textTrack.activeCues.length) {
            //   const allCues = Array.from(textTrack.cues as any as FilteredVTTCue[]);
            //   const textMatchCues = instance.cuesIncludingText(allCues, originalText, 'originalText');
            //   const timeMatchCues = instance.cuesInTimeRange(textMatchCues, currentTime, 10, (rule.checkInterval * 2) * 0.001);
            //   if (timeMatchCues.length == captions.length) {
            //     data.skipped = true;
            //     return false;
            //   }
            // }

            // These are new captions
            instance.unmute(rule, video);
            instance.lastProcessedText = originalText;

            // Hide current active cues (if any)
            if (textTrack && textTrack.activeCues && textTrack.activeCues.length) {
              const activeCues = Array.from(textTrack.activeCues as any as FilteredVTTCue[]);
              // Because we don't have an endTime when we create the cues, this will set that to -1ms
              activeCues.forEach((cue) => cue.endTime = currentTime - .001);
            }

            const duration = video.duration;

            // Reverse captions when being added to video textTrack
            captions.reverse();

            captions.forEach((caption) => {
              // Don't process empty/whitespace nodes
              if (caption.textContent && caption.textContent.trim()) {
                const result = instance.replaceTextResult(caption.textContent);
                data.textResults.push(result);
                if (result.modified) {
                  instance.mute(rule, video);
                  data.filtered = true;
                }

                // Add current caption text as APF Cue
                const cueText = rule.filterSubtitles ? result.filtered : result.original;
                const cue = instance.newCue(currentTime, duration, cueText) as FilteredVTTCue;
                cue.filtered = data.filtered;
                cue.originalText = result.original;
                textTrack.addCue(cue);
              }
            });

            // Hide/show cues
            const shouldBeShown = instance.subtitlesShouldBeShown(rule, data.filtered);
            if (!rule.videoCueHideCues) { textTrack.mode = shouldBeShown ? 'showing' : 'hidden'; }
          }
        }  else {
          // If there are no captions/subtitles: unmute and hide
          instance.watcherSimpleUnmute(rule, video);

          // Hide any activeCues
          if (textTrack && textTrack.activeCues && textTrack.activeCues.length) {
            const activeCues = Array.from(textTrack.activeCues as any as FilteredVTTCue[]);
            // Because we don't have an endTime when we create the cues, this will set that to -1ms
            activeCues.forEach((cue) => cue.endTime = currentTime - .001);
          }

          // Hide/show textTrack
          const shouldBeShown = instance.subtitlesShouldBeShown(rule, data.filtered);
          if (!rule.videoCueHideCues) textTrack.mode = shouldBeShown ? 'showing' : 'hidden';
        }
      }

      if (data.skipped) { return false; } // TODO: Cue - Not needed when in same function
      if (data.filtered) { instance.filter.updateCounterBadge(); }
    } else {
      if (rule.ignoreMutations) { instance.filter.startObserving(); } // Start observing when video is not playing
    }
  }

  youTubeAutoSubsCurrentRow(node): boolean {
    return !!(node.parentElement.parentElement == node.parentElement.parentElement.parentElement.lastChild);
  }

  youTubeAutoSubsMuteTimeout(instance) {
    const video = window.document.querySelector(WebAudio.defaultVideoSelector);
    if (video && instance.playing(video)) {
      instance.unmute(instance.youTubeAutoSubsRule);
    }
    instance.youTubeAutoSubsTimeout = null;
  }

  youTubeAutoSubsNodeIsSubtitleText(node): boolean {
    const captionWindow = document.querySelector('div.caption-window'); // YouTube Auto-gen subs
    return !!(captionWindow && captionWindow.contains(node));
  }

  youTubeAutoSubsPresent(): boolean {
    const present = !!(document.querySelector('div.ytp-caption-window-rollup'));
    if (present) this.supportedCaptionsFound();
    return present;
  }

  youTubeAutoSubsSupportedNode(node: any): boolean {
    if (node.nodeName == '#text' && node.textContent != '') {
      return !!(this.youTubeAutoSubsNodeIsSubtitleText(node));
    }
    return false;
  }
}
