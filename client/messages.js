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
  contactAdded: "New crew member aboard",
  contactRemoved: "Crew member departed",
  contactRequestSent: "Hail sent",
  contactRequestAccepted: "Welcome aboard!",
  joined: "You're in the air",
  left: "You've jumped ship",
  crewCreated: "Crew assembled",
  crewDeleted: "Crew disbanded",
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
  noContacts: "No crew yet",
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
  participantRemoved: "Crew member removed from wave",
  participantLeft: "A crew member jumped ship",
  participantKicked: "Crew member shown the airlock",
  addedToWave: (title) => `You've been pulled into "${title}"`,
  removedFromWave: (title) => `You've been pulled from "${title}"`,
  contactRequestReceived: (name) => `${name} wants to join your crew`,
  contactRequestAccepted: "Your hail was answered — welcome aboard!",
  contactRequestDeclined: "Your hail was declined",
  crewInviteReceived: (inviter, crew) => `${inviter} wants you in the ${crew} crew`,
  crewInviteAccepted: "Crew invite accepted",
  crewInviteDeclined: "Crew invite declined",
  contactRequestExpired: "Your hail timed out — no answer from the black",
  crewInviteExpired: "Crew invite expired — silence in the void",
  federationRequest: (node) => `Docking request from ${node}`,
  watchPartyStarted: (name) => `${name} started a watch party`,
  watchPartyEnded: "Watch party ended",
};

// ============ CONFIRM DIALOG MESSAGES ============
export const CONFIRM_DIALOG = {
  deleteCrew: "Disband this crew? There's no putting it back together.",
  leaveCrew: "Jump ship from this crew? You'll need a new invite to get back.",
  leaveWave: "Leave this wave? You'll drift out of range.",
  deleteMessage: "Scrub this signal from the cortex? Can't unring that bell.",
  deleteBot: (name) => `Decommission ${name}? This can't be undone.`,
  regenerateKey: "Generate new encryption keys? Old messages stay locked with the old keys.",
  removeConnection: "Cut ties with this contact? The black is lonely.",
  removeFederationNode: "Cut this port loose from the Verse?",
  declineFederationRequest: "Deny docking clearance for this request?",
  deleteAlert: "Scrub this alert from the cortex?",
  unsubscribe: "Stop listening on this channel?",
  deleteCategory: "Jettison this category? Waves inside will go uncategorized.",
  removeParticipant: (name) => `Show ${name} the airlock?`,
  revokeAccess: (title) => `Revoke access to "${title}"? They'll be cut off.`,
  deleteWebhook: "Pull the plug on this webhook?",
  clearLocalData: "Wipe local data? You'll need to log in again.",
  deleteTheme: (name) => `Jettison the "${name}" theme? Can't get it back.`,
};

// ============ FEDERATION / THE VERSE ============
export const FEDERATION = {
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
  broadcastBtn: "Broadcast to the Verse",
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
