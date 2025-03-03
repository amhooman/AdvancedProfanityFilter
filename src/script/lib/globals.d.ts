interface AudioRule {
  _displayElement?: HTMLElement;                 // Element to display/hide
  _dynamic?: boolean;                            // [Dynamic] Set to true on a dynamic rule
  apfCaptions?: boolean;                         // [Cue] Display an HTML version of the caption/subtitle text: Requires videoCueHideCues = true
  apfCaptionsSelector?: string;                  // [Cue] Selector for container that will hold the custom HTML captions
  apfCuesLabel?: string;                         // [Watcher.toCue] TextTrack label for APF Cues (Default: 'APF-Cues')
  buildTarget?: string;                          // [All] Only allow rule to run on a specific buildTarget
  checkInterval?: number;                        // [Watcher] Set a custom watch interval (in ms, Default: 20)
  className?: string;                            // [Element] node.className.includes()
  containsSelector?: string;                     // [Element] node.querySelector() [Not commonly used]
  convertBreaks?: boolean;                       // [Element,ElementChild] Convert <br> to '\n'
  dataPropPresent?: string;                      // [Element] node.dataset.hasOwnProperty()
  disabled?: boolean;                            // [All] Set automatically based on iframe status or missing a required property
  displayElementLevels?: number;                 // [Watcher] Number of levels (ancestors) to get _displayElement
  displayHide?: string;                          // [Element,ElementChild,Watcher] Display style for hiding captions (Default: 'none')
  displaySelector?: string;                      // [Element,ElementChild,Watcher] Alternate selector to hide/show captions
  displaySelectorParents?: number;               // [Element,ElementChild,Watcher] Number of levels to go above displaySelector's element
  displayShow?: string;                          // [Element,ElementChild,Watcher] Display style for showing captions (Default: '')
  displayVisibility?: boolean;                   // [Watcher*] Use visibility to show/hide caption container
  dynamicClasslist?: string;                     // [Dynamic] Set when a dynamicTextKey is found
  dynamicTargetMode?: string;                    // [Dynamic] Target mode for dynamic rule
  dynamicTextKey?: string;                       // [Dynamic] Key used to identify a dynamic caption node
  externalSub?: boolean;                         // [Cue] [BETA]: Convert external captions/subtitles obtained from remote source to VTTCues
  externalSubFormatKey?: string;                 // [Cue] [BETA]: Key name for caption/subtitle format (Default: 'format')
  externalSubTrackLabel?: string;                // [Cue] [BETA]: Label used for processed TextTrack
  externalSubTrackMode?: TextTrackMode;          // [Cue] [BETA]: TextTrack mode for new TextTrack
  externalSubURLKey?: string;                    // [Cue] [BETA]: Key name for caption/subtitle URL (Default: 'url')
  externalSubVar?: string;                       // [Cue] [BETA]: Global variable to find available caption/subtitle data
  filterSubtitles?: boolean;                     // [All] Filter subtitle text (Default: true)
  getParentLevel?: number;                       // [Dynamic,Watcher] Number of levels (ancestors) to go up to when looking for container
  hasChildrenElements?: boolean;                 // [Element] node.childElementCount > 0 [Not commonly used]
  iframe?: boolean | undefined;                  // [All] Pages to run on (true: only iframes, false: no iframes, undefined: all)
  ignoreMutations?: boolean;                     // [Element,ElementChild,Text,Watcher] Ignore mutations when filtering captions/subtitles
  mode: string;                                  // [All*] 'cue', 'dynamic', 'element', 'elementChild', 'text', 'watcher'
  muteMethod?: number;                           // [All] Override global muteMthod (0: tab, 1: video)
  note?: string;                                 // [All] Note about the rule
  parentSelector?: string;                       // [ElementChild?,Text,Watcher] parent.contains(node)
  parentSelectorAll?: string;                    // [ElementChild?] Check if any parents contain the node: parent.contains(node)
  preserveWhiteSpace?: boolean;                  // [Element,ElementChild] Set whiteSpace = 'pre' on subtitle elements
  removeSubtitleSpacing?: boolean;               // [Element] Remove subtitle padding/margin when hiding
  rootNode?: boolean;                            // [Element,ElementChild] Use getRootNode() or assume document (Default: false)
  showSubtitles?: number;                        // [All] Override global showSubtitles (0: all, 1: filtered, 2: unfiltered, 3: none)
  simpleUnmute?: boolean;                        // [Element,ElementChild,Text+,Watcher+] Simplify requirements for unmuting (should be first rule)
  subtitleSelector?: string;                     // [Element,ElementChild,Watcher] *Used for Filtering*: node.querySelectorAll()
  tagName?: string;                              // [Element*,ElementChild*] node.nodeName
  toCue?: boolean;                               // [Watcher] [BETA]: Convert page element captions to video textTrack cues
  unmuteDelay?: number;                          // [Element,ElementChild,Watcher] Positive number (in ms) to delay unmuting
  videoCueHideCues?: boolean;                    // [Cue] Remove/hide cues instead of setting textTrack.mode = 'hidden'
  videoCueKind?: string;                         // [Cue] Kind of video TextTrack ('captions', 'subtitles', etc.)
  videoCueLabel?: string;                        // [Cue] Label for video TextTrack
  videoCueLanguage?: string;                     // [Cue] Language for video TextTrack
  videoCueRequireShowing?: boolean;              // [Cue] Override global setting for muteCueRequireShowing
  videoCueSync?: number;                         // [Cue] Adjust subtitle sync +/- (in seconds)
  videoSelector?: string;                        // [Cue,Watcher] Selector for video, also used for volume muteMethod (Default: 'video')
}

interface AudioSites {
  [site: string]: AudioRule[];
}

interface BackgroundData {
  disabledTab?: boolean;
}

interface BackgroundStorage {
  tabs?: {
    [tabId: number]: TabStorageOptions;
  };
}

interface BuildTargetSites {
  disabledSites: string[];
  sites: AudioSites;
}

interface ConfirmModalSettings {
  backup?: boolean;
  content?: string;
  title?: string;
  titleClass?: string;
}

interface DomainCfg {
  adv?: boolean;
  audioList?: number;
  deep?: boolean;
  disabled?: boolean;
  enabled?: boolean;
  framesOff?: boolean;
  framesOn?: boolean;
  wordlist?: number;
}

interface FilteredVTTCue extends VTTCue {
  filtered: boolean;
  filteredText: string;
  originalText: string;
  position: number; // TextTrackCue
  size: number; // TextTrackCue
}

interface Message {
  advanced?: boolean;
  backgroundData?: boolean;
  captions?: boolean;
  clearMute?: boolean;
  counter?: number;
  deep?: boolean;
  destination: string;
  disabled?: boolean;
  fetch?: string;
  fetchMethod?: string;
  forceUpdate?: boolean;
  getStatus?: boolean;
  globalVariable?: string;
  iframe?: boolean;
  mute?: boolean;
  mutePage?: boolean;
  popup?: boolean;
  source: string;
  status?: number;
  summary?: Summary;
  tabId?: number;
  updateContextMenus?: boolean;
  urlUpdate?: string;
}

interface Migration {
  async?: boolean;
  name: string;
  runOnImport: boolean;
  version: string;
}

interface ParsedSubOptions {
  align?: AlignSetting;
  line?: string;
  position?: string;
}

interface ReplaceTextResult {
  filtered: string;
  modified: boolean;
  original: string;
}

interface Statistics {
  mutes: number;
  startedAt?: number;
  words: WordStatistics;
}

interface Summary {
  [word: string]: {
    filtered: string;
    count: number;
  };
}

interface TabStorageOptions {
  disabled?: boolean;
  disabledOnce?: boolean;
  id?: number;
  registeredAt?: number;
  status?: number;
}

interface Version {
  major: number;
  minor: number;
  patch: number;
}

interface WatcherData {
  filtered: boolean;
  initialCall: boolean;
  skipped?: boolean;
  textResults: ReplaceTextResult[];
}

interface WordOptions {
  _filterMethod?: number;  // This should not be stored in the config. Only there for new Word
  case?: number;
  lists?: number[];
  matchMethod: number;
  repeat: number;
  separators?: number;
  sub: string;
}

interface WordStatistic {
  audio: number;
  text: number;
  total?: number;
}

interface WordStatistics {
  [word: string]: WordStatistic;
}
