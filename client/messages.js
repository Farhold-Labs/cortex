import { T } from './src/config/terminology.js';
// Firefly-themed messages for Cortex
// "Can't stop the signal, Mal."

// ============ SUCCESS MESSAGES ============
export const SUCCESS = {
  generic: "Shiny!",
  messageSent: "Signal's away",
  messageUpdated: "Signal corrected",
  messageDeleted: "Signal scrubbed",
  waveCreated: "New signal on the cortex",
  waveUpdated: "Signal adjusted",
  waveDeleted: "Signal terminated",
  waveArchived: "Signal archived",
  waveRestored: "Signal restored",
  copied: "Coordinates locked",
  contactAdded: `New ${T.crew} member aboard`,
  contactRemoved: `${T.Crew} member departed`,
  contactRequestSent: "Hail sent",
  contactRequestAccepted: "Welcome aboard!",
  joined: "You're in the air",
  left: "You've jumped ship",
  crewCreated: `${T.Crew} assembled`,
  crewDeleted: `${T.Crew} disbanded`,
  invitationSent: "Invitation transmitted",
  profileUpdated: "Ship's log updated",
  passwordChanged: "New codes set",
  shared: "Signal boosted",
  encrypted: "Running silent",
  reported: "Report filed with the Alliance",
  blocked: "Airlock sealed",
  unblocked: "Airlock opened",
  muted: "Comm channel muted",
  unmuted: "Comm channel open",
  pingSent: "Signal's away",
};

// ============ ERROR PREFIX ============
export const ERROR_PREFIX = "Gorram it!";

// ============ EMPTY STATES ============
export const EMPTY = {
  noWaves: "Cortex is quiet",
  noWavesCreate: "Cortex is quiet. Start a signal?",
  noNotifications: "Ain't heard a peep",
  noPings: "Nothing but black out here",
  noSearchResults: "Nothing in the black matches that",
  noContacts: `No ${T.crew} yet`,
  noCrews: "Flying solo",
  noGifs: "No captures found",
  noUsers: "No souls out here",
  noAlerts: "All quiet on the cortex",
  noSessions: "No active docking bays",
};

// ============ LOADING STATES ============
export const LOADING = {
  generic: "Spinning up...",
  searching: "Scanning the cortex...",
  sending: "Transmitting...",
  connecting: "Awaiting docking clearance...",
  loading: "Spinning up...",
  encrypting: "Running encryption protocols...",
  uploading: "Uploading cargo...",
};

// ============ CONFIRMATION BUTTONS ============
export const CONFIRM = {
  delete: "Let's be bad guys",
  destructive: "I aim to misbehave",
  cancel: "Belay that",
  leave: "Jump ship",
  confirm: "Do the job",
};

// ============ FOOTER TAGLINES ============
export const TAGLINES = [
  "Can't stop the signal",
  "Keep flying",
  "We're still flying, that's something",
  "You can't take the sky from me",
  "Find a crew, find a job, keep flying",
  "Privacy isn't a feature, it's a foundation",
  "The signal is strong",
  "Shiny",
  "I aim to misbehave",
  "We have done the impossible, and that makes us mighty",
];

// ============ HELPERS ============
export const getRandomTagline = () =>
  TAGLINES[Math.floor(Math.random() * TAGLINES.length)];

// Format error with Firefly prefix (for non-technical errors)
export const formatError = (message) =>
  `${ERROR_PREFIX} ${message}`;

// ============ ERROR MESSAGES ============
export const ERROR = {
  generic: "Something went sideways",
  connectionFailed: "Lost signal",
  serverUnreachable: "Ship's grounded",
  accessDenied: "Alliance interference",
  sendFailed: "Signal didn't make it",
  loadFailed: "Couldn't pull that in",
  uploadFailed: "Cargo didn't make it aboard",
  deleteFailed: "Couldn't jettison that",
  updateFailed: "Couldn't patch that through",
  encryptionFailed: "Encryption protocols failed",
  searchFailed: "Scanner's on the fritz",
  notFound: "Nothing out there in the black",
};

// ============ NOTIFICATION MESSAGES ============
export const NOTIFICATION = {
  waveDeleted: (title) => `"${title}" has gone dark`,
  keyRotated: "Encryption keys rotated",
  participantAdded: (name) => `${name} has boarded`,
  participantRemoved: `${T.Crew} member removed from ${T.wave}`,
  participantLeft: `A ${T.crew} member jumped ship`,
  participantKicked: `${T.Crew} member shown the airlock`,
  addedToWave: (title) => `You've been pulled into "${title}"`,
  removedFromWave: (title) => `You've been pulled from "${title}"`,
  contactRequestReceived: (name) => `${name} wants to join your ${T.crew}`,
  contactRequestAccepted: "Your hail was answered — welcome aboard!",
  contactRequestDeclined: "Your hail was declined",
  crewInviteReceived: (inviter, crew) => `${inviter} wants you in the ${crew} ${T.crew}`,
  crewInviteAccepted: `${T.Crew} invite accepted`,
  crewInviteDeclined: `${T.Crew} invite declined`,
  contactRequestExpired: "Your hail timed out — no answer from the black",
  crewInviteExpired: `${T.Crew} invite expired — silence in the void`,
  federationRequest: (node) => `Docking request from ${node}`,
  watchPartyStarted: (name) => `${name} started a watch party`,
  watchPartyEnded: "Watch party ended",
};

// ============ CONFIRM DIALOG MESSAGES ============
export const CONFIRM_DIALOG = {
  deleteCrew: `Disband this ${T.crew}? There's no putting it back together.`,
  deleteMessage: "Scrub this signal from the cortex? Can't unring that bell.",
  deleteBot: (name) => `Decommission ${name}? This can't be undone.`,
  regenerateKey: "Generate new encryption keys? Old messages stay locked with the old keys.",
  regenerateBotKey: "Generate a new API key for this bot? The old key keeps working until the bot uses the new one, or you retire it.",
  removeConnection: "Cut ties with this contact? The black is lonely.",
  removeFederationNode: "Cut this port loose from the Verse?",
  declineFederationRequest: "Deny docking clearance for this request?",
  deleteAlert: "Scrub this alert from the cortex?",
  unsubscribe: "Stop listening on this channel?",
  deleteCategory: `Delete this folder? ${T.Waves} in it stay in your list, outside any folder.`,
  // v2.148.0 — asked in the app (askConfirm), not with the browser's confirm().
  // Removing a contact or a crew member acted on one tap before.
  removeContact: (name) => ({ title: 'Remove contact', confirmLabel: 'Remove',
    message: `Remove ${name} from your contacts? You'll need to send a new contact request to add them back.` }),
  removeCrewMember: (name) => ({ title: `Remove from ${T.crew}`, confirmLabel: 'Remove',
    message: `Remove ${name} from this ${T.crew}? They lose its ${T.waves} and need a new invite to come back.` }),
  leaveWaveAsk: (title) => ({ title: `Leave ${T.wave}`, confirmLabel: 'Leave',
    message: `Leave "${title}"? You won't see new pings in it, and you'll need to be invited back.` }),
  removeParticipantAsk: (name, title) => ({ title: `Remove from ${T.wave}`, confirmLabel: 'Remove',
    message: `Remove ${name} from "${title}"? They won't see new pings in it.` }),
  leaveCrewAsk: (name) => ({ title: `Leave ${T.crew}`, confirmLabel: 'Leave',
    message: `Leave ${name ? `"${name}"` : `this ${T.crew}`}? You'll lose its ${T.waves} and need a new invite to come back.` }),
  revokeAccess: (title) => `Revoke access to "${title}"? They'll be cut off.`,
  deleteWebhook: "Pull the plug on this webhook?",
  clearLocalData: "Wipe local data? You'll need to log in again.",
  deleteTheme: (name) => `Jettison the "${name}" theme? Can't get it back.`,
};

// ============ FEDERATION / THE VERSE ============
export const FEDERATION = {
  // Signing key handover (v2.147.0)
  signingKey: "Signing key",
  keyLabel: "Key",
  nextKey: "New key",
  nextKeyAnnounced: "new key announced",
  replaceKey: "REPLACE KEY",
  keyWasExposed: "KEY WAS EXPOSED",
  replaceKeyHint: "REPLACE KEY gives every allied port the new key first; the old one keeps working until each has confirmed it. Use KEY WAS EXPOSED only if the private key has leaked.",
  replaceKeyConfirm: "Replace this port's signing key?\n\nEvery allied port is sent the new key. The current key keeps working until each one confirms it has received the new one, so nothing stops working in the meantime.",
  replaceKeyStarted: "New key sent. The old key stays in use until every allied port confirms it.",
  replaceKeyDone: "Key replaced. Every allied port confirmed the new key.",
  keyHandoverInProgress: "Key replacement in progress. The current key stays in use until every allied port below has confirmed the new one.",
  allyConfirmed: "confirmed",
  allyWaiting: (attempts, at) => attempts
    ? `waiting · tried ${attempts}× · last ${at ? new Date(at).toLocaleString() : ''}`
    : 'not yet told',
  suspendedNotWaited: "suspended, not waited for",
  tellAgainNow: "TELL AGAIN NOW",
  cancelKeyChange: "CANCEL",
  cancelKeyConfirm: "Cancel the key replacement? The new key is deleted and allied ports are told to forget it.",
  cancelKeyDone: "Key replacement cancelled.",
  withdrawalsOwed: (names) => `Still telling ${names.join(', ')} to forget a cancelled key.`,
  exposedKeyPrompt: (name, count) => `ONLY IF THE PRIVATE KEY HAS LEAKED.\n\nThe key is replaced at once and nobody is told: whoever has the old key could forge the announcement. All ${count} allied port(s) will refuse this port until their admins press FETCH KEY AGAIN and compare the new fingerprint with you.\n\nType this port's name (${name}) to confirm:`,
  exposedKeyDone: (fp, cutOff) => `Key replaced: ${fp}. ${cutOff.length ? `Ask the admins of ${cutOff.join(', ')} to press FETCH KEY AGAIN and check this fingerprint.` : ''}`,
  keyStepUpReason: "Confirm your password to change this port's signing key",
  keyActionFailed: "The key change failed",
  fetchKeyAgain: "FETCH KEY AGAIN",
  fetchKeyAgainHint: "Read this port's key from its address again. Only needed if its admin replaced an exposed key; compare the fingerprint with them.",
  nameChangeHint: "⚠ The name can't change while this port has allies: each one knows it by this name. Unpair them first. The key is kept.",
  // Panel headings & section labels
  panelHeading: "THE VERSE",
  portIdentity: "Port Identity",
  alliedPorts: "Allied Ports",
  incomingRequests: "Incoming Docking Requests",
  alertSubscriptions: "ALERT SUBSCRIPTIONS",

  // Status badges
  verseConnected: "VERSE CONNECTED",
  verseEnabled: "ENABLED",
  verseDisabled: "DISABLED",
  awaitingResponse: "AWAITING RESPONSE",
  declined: "DECLINED",
  keypairOk: "KEYPAIR OK",
  noKeypair: "NO KEYPAIR",

  // Stats
  alliedPortsCount: "Allied Ports",
  activeCount: "Active",

  // Buttons & actions
  requestDocking: "Request Docking",
  dock: "DOCK",
  docking: "DOCKING...",
  addPort: "+ ADD PORT",
  addPortBtn: "ADD PORT",
  configure: "CONFIGURE",
  accept: "ACCEPT",
  accepting: "ACCEPTING...",
  denyDocking: "DECLINE",
  suspend: "SUSPEND",
  reactivate: "REACTIVATE",
  block: "BLOCK",
  sendingRequest: "SENDING...",
  sendRequest: "REQUEST DOCKING",

  // Port/node form labels & placeholders
  portNamePlaceholder: "farhold.example.com",
  portUrlPlaceholder: "Server URL (e.g., https://other-farhold.com)",
  addPortNamePlaceholder: "Port name (e.g., other-farhold.com)",
  addPortUrlPlaceholder: "Base URL (e.g., https://other-farhold.com)",
  optionalMessagePlaceholder: "Optional message (e.g., Requesting permission to dock!)",

  // Help text & descriptions
  requestDockingHelp: "Send a docking request to another Cortex port. They will need to grant docking clearance.",
  envHint: "Set FEDERATION_ENABLED=true in server environment to enable the Verse.",
  portNameMinLength: "Port name must be at least 3 characters",
  portNameUrlRequired: "Port name and URL are required",

  // Empty states
  noAlliedPorts: "No allied ports in the Verse",
  noAlertSubscriptions: "No alert subscriptions configured",

  // Toast messages
  identityConfigured: "Port identity configured",
  portAdded: "Port added to the Verse",
  portRemoved: "Port removed from the Verse",
  dockingSuccessful: "Docking successful",
  dockingRequestSent: "Docking request transmitted!",
  dockingRequestAccepted: "Docking request accepted!",
  dockingRequestDeclined: "Docking request denied",
  requestWasDeclined: "Request was declined",
  waitingForResponse: "Waiting for their response...",
  lastContact: "Last contact",

  // Travelers (federated users)
  addTravelers: "ADD TRAVELERS",
  travelersLabel: "TRAVELERS",
  travelerFrom: (node) => `Traveler from ${node}`,
  travelerFormatHint: "Format: @handle@server.com (traveler from another port)",
  manageTravelers: "Manage travelers",

  // Wave federation
  broadcastToVerse: "BROADCAST TO THE VERSE",
  inviteTravelersTitle: "INVITE TRAVELERS",
  broadcastBtn: "Invite travelers from other ports",
  inviteTravelers: "Invite travelers from other ports to join",
  scopeFederated: "Verse-Wide (broadcast to allied ports)",

  // Section labels in settings
  verseSection: "THE VERSE",

  // Alert subscriptions
  subscribeInfo: "Subscribe to receive alerts from allied ports. Choose which categories to receive.",
  alliedPortLabel: "ALLIED PORT",
  selectPort: "Select a port...",
  subscribedToAllPorts: "(subscribed to all ports)",
  noAlliedPortsConfigured: "(no allied ports configured)",
  selectAlliedPort: "Please select an allied port",

  // About page
  alliedPortsLabel: (count) => `Allied Ports (${count})`,
  noAlliedPortsYet: "No allied ports yet",

  // formatError replacements
  failedToLoadVerse: "Failed to load Verse data",
  failedToConfigureIdentity: "Failed to configure port identity",
  failedToAddPort: "Failed to add port",
  failedToDock: "Docking failed",
  failedToRemovePort: "Failed to remove port",
  failedToUpdateStatus: "Failed to update port status",
  failedToSendRequest: "Failed to send docking request",
  failedToAcceptRequest: "Failed to accept docking request",
  failedToDeclineRequest: "Failed to decline docking request",
  failedToInviteTravelers: "Failed to invite travelers",

  // Cover Traffic (v2.28.0)
  coverTrafficSection: "COVER TRAFFIC",
  runningDark: "RUNNING DARK",
  exposed: "EXPOSED",
  coverTrafficEnabled: "Cover traffic active",
  coverTrafficDisabled: "Cover traffic inactive — federation traffic patterns are visible",
  startCoverTraffic: "RUN DARK",
  stopCoverTraffic: "GO VISIBLE",
  coverTrafficStarted: "Running dark — cover traffic active",
  coverTrafficStopped: "Cover traffic stopped",
  activeTargets: "Active Targets",
  decoysSent: "Decoys Sent",
  lastDecoy: "Last Decoy",
  protocolVersion: "Protocol",
  v2Badge: "V2",
  v1Badge: "V1",
  coverTrafficDescription: "Sends decoy signals to allied ports to mask real traffic patterns. Only works with V2 ports.",
};

// ============ SESSION EXPIRY (v2.29.0) ============
export const SESSION = {
  expiring: "Session Expiring",
  expiringMessage: "Your session is about to expire. Enter your password to stay connected.",
  extendSession: "EXTEND SESSION",
  extending: "EXTENDING...",
  extended: "Session extended",
  selectDuration: "SESSION DURATION",
  expired: "Session Expired",
  expiredMessage: "Your session has expired. Enter your password to continue.",
  continueSession: "CONTINUE SESSION",
  continuing: "CONTINUING...",
};

// ============ SERVER CONNECTION (v2.30.0) ============
export const SERVER = {
  changeServer: "Change server",
  serverUrl: "SERVER URL",
  serverUrlPlaceholder: "https://cortex.example.com",
  serverUrlHint: "Enter the URL of the Cortex port to connect to",
  connect: "CONNECT",
  testing: "TESTING...",
  resetToDefault: "RESET TO DEFAULT",
  invalidUrl: "Invalid URL format",
  enterUrl: "Please enter a server URL",
};

// ============ UI LABELS ============
export const UI_LABELS = {
  exportData: "Ship's Manifest",
  deleteAccount: "Abandon Ship",
  downloadData: "DOWNLOAD SHIP'S MANIFEST",
  exportingData: "PREPARING MANIFEST...",
};

// ============ ERROR BOUNDARY ============
export const ERROR_BOUNDARY = {
  title: "Gorram it! Something went sideways",
  retry: "Try to reboot",
  stackTrace: "Diagnostic readout",
};

// ============ OFFLINE INDICATOR ============
export const OFFLINE = {
  message: "LOST SIGNAL — Running on reserve power",
};

// ============ VERSION CHECK ============
export const VERSION_CHECK = {
  outdated: "New version available on the cortex",
  refresh: "REFRESH",
};

// ============ GHOST PROTOCOL (v2.27.0) ============
export const GHOST_PROTOCOL = {
  menuItem: "Ghost Protocol",
  enterPin: "Enter Ghost Protocol PIN",
  setPin: "Set Ghost Protocol PIN",
  confirmPin: "Confirm PIN",
  modeActive: "GHOST PROTOCOL",
  waveHidden: "Gone dark. Can't find you in the black.",
  waveRevealed: "Signal visible again",
  pinSet: "Ghost Protocol activated",
  pinChanged: "Ghost Protocol codes updated",
  pinIncorrect: "Wrong codes, try again",
  noHiddenWaves: "Nothing hidden in the black",
  exit: "EXIT GHOST PROTOCOL",
  hideWave: "Go Dark",
  revealWave: "Reveal Signal",
  genericNotification: "New activity on the cortex",
};

// Encryption key fingerprints (v2.149.0, docs/federated-e2ee/ phase 1).
export const KEY_FINGERPRINT = {
  // v2.150.0: a fingerprint is of a person's identity, which lasts; their
  // encryption keys can be replaced under it.
  yourKey: 'Your fingerprint',
  yourKeyHint: 'Read this to someone over a call or in person; they compare it with what their app shows for you. It stays the same when you replace your keys, so their verification of you stays too.',
  theirKey: (name) => `${name}'s fingerprint`,
  compareHint: (name) => `Ask ${name} to read you the fingerprint in their Settings → Security → Your fingerprint, over a call or in person, not in a message here. Mark it verified only if every character matches.`,
  noKey: (name) => `${name} hasn't set up encryption yet.`,
  legacy: (name) => `${name} has no fingerprint yet. It appears once they open Cortex and set it up. Until then their key is checked as before: a change is flagged.`,
  locked: 'Unlock encryption to see fingerprints.',
  loadFailed: 'Could not look up this fingerprint.',
  verified: '✓ VERIFIED',
  notVerified: 'NOT VERIFIED',
  changed: '⚠ FINGERPRINT CHANGED',
  changedShort: '⚠ CHANGED',
  lost: '⚠ CHANGED SINCE YOU VERIFIED',
  lostShort: '⚠ VERIFY AGAIN',
  recheck: '⚠ COMPARE ONCE MORE',
  recheckShort: '⚠ COMPARE AGAIN',
  unsigned: '⚠ KEYS NOT SIGNED',
  unsignedShort: '⚠ NOT SIGNED',
  changedHint: (name) => `${name}'s fingerprint changed. That happens when someone loses both their password and recovery key, or replaces their fingerprint. If you didn't expect it, check with them another way.`,
  lostHint: (name) => `You had verified ${name}, and their fingerprint has changed since, so that verification no longer holds. Compare the new one before marking it again.`,
  recheckHint: (name) => `You verified ${name}'s key before fingerprints lasted. Compare this fingerprint once more; after that it stays verified when they replace their keys.`,
  unsignedHint: (name) => `The keys this server gives for ${name} aren't signed by their fingerprint. Their own app never does that, so your app gives them no keys to encrypted ${T.waves} until it's resolved. Tell them, and your server's admin.`,
  markVerified: 'MARK AS VERIFIED',
  unmarkVerified: 'REMOVE VERIFICATION',
  showKey: 'KEY',
  verifyAsk: (name, fp) => ({
    title: `Verify ${name}?`,
    message: `Only if ${name} read you this exact fingerprint over a call or in person:\n\n${fp}`,
    confirmLabel: 'IT MATCHES',
  }),
  keyMovedOn: 'Their fingerprint changed while you were looking. Compare the new one.',

  // Your own identity
  noneTitle: "You don't have a fingerprint yet.",
  noneHint: 'Your fingerprint lets people check that nobody has swapped your keys, and it stays the same when you replace them. It is locked by your recovery key, not your password, so someone who steals your password can\'t take it.',
  enterRecovery: 'Your recovery key',
  create: 'CREATE MY FINGERPRINT',
  noRecovery: "I DON'T HAVE MY RECOVERY KEY",
  newRecoveryTitle: 'Your new recovery key',
  newRecoveryHint: 'Save it somewhere safe, away from your password. It opens your encryption if you forget your password, and it is the only thing that can change your keys while keeping your fingerprint. It replaces your old one.',
  saved: "I'VE SAVED IT",
  copy: 'COPY',
  copied: '✓ COPIED',
  cancel: 'CANCEL',
  staleTitle: 'Your fingerprint is from before your encryption was reset.',
  staleHint: 'Enter your previous recovery key to keep it, so people who verified you stay verified. Or start a new fingerprint; they will see it change.',
  previousRecovery: 'Your previous recovery key',
  keep: 'KEEP MY FINGERPRINT',
  startNew: 'START A NEW FINGERPRINT',
  elsewhere: 'Your keys were replaced on another device. Lock encryption and unlock it again to use them here.',
  mismatch: "The server is giving out a statement for your keys that your fingerprint didn't sign. Tell your server's admin.",
  unknown: 'Your fingerprint could not be loaded.',
  changedSelf: (when) => `Your fingerprint changed on ${when}. If you didn't do that, someone had your recovery key: replace your fingerprint.`,
  replaceKeys: 'REPLACE MY KEYS',
  replaceKeysHint: 'New encryption keys under the same fingerprint: for a stolen password or an exposed key. Change your password first if it was stolen.',
  password: 'Password that unlocks your encryption',
  replaceKeysGo: 'REPLACE KEYS',
  keysReplaced: (dropped) => `Your keys were replaced. Your fingerprint is the same.${dropped ? ` ${dropped} ${T.wave} key(s) couldn't be carried over and will be asked for again.` : ''}`,
  replaceIdentity: 'REPLACE MY FINGERPRINT',
  replaceIdentityAsk: {
    title: 'Replace your fingerprint?',
    message: 'Only if your recovery key was lost or stolen. Everyone who verified you sees your fingerprint change and has to compare again.\n\nYou get a new recovery key.',
    confirmLabel: 'REPLACE',
  },
  identityDone: 'Your fingerprint is set up.',
  later: 'LATER',
  currentRecovery: 'Your current recovery key',
  currentRecoveryHint: "It carries your fingerprint over to the new one. If you've lost it, replace your fingerprint instead (under Your fingerprint): that makes a new recovery key too.",
};
