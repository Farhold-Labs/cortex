// Video call layout (v2.144.0): who fills the screen, who is the small
// picture-in-picture, who goes in the strip. Pure, so it can be tested.
//
// It used to be an equal grid, everyone the same size, yourself included.
// People expect what phone calls do: the other person fills the screen and
// you are a small preview in the lower right.
//
// A track is { id, participantId, isLocal, isScreen }.
// A person is { participantId, name } (people here other than you).

/**
 * @param {Array} tracks      live camera and screen-share tracks
 * @param {object} opts
 * @param {string|null} opts.pinnedId  a track someone tapped to fill the screen
 * @param {string|null} opts.speakerId the last person to speak who has a camera
 * @param {Array} opts.others          the other people in the call
 * @returns {{ main, mainPerson, pip, strip }}
 *   main: the track that fills the screen, or null;
 *   mainPerson: when no one else has video, the person to show by name;
 *   pip: your own camera, small in the corner, or null;
 *   strip: every other track, as thumbnails.
 */
export function chooseCallLayout(tracks, { pinnedId = null, speakerId = null, others = [] } = {}) {
  const localCam = tracks.find(t => t.isLocal && !t.isScreen) || null;
  const remote = tracks.filter(t => !t.isLocal);

  let main = (pinnedId && tracks.find(t => t.id === pinnedId)) || null;
  // Someone else's screen is what everyone is there to see.
  if (!main) main = remote.find(t => t.isScreen) || null;
  if (!main && speakerId) main = remote.find(t => !t.isScreen && t.participantId === speakerId) || null;
  if (!main) main = remote.find(t => !t.isScreen) || null;

  let mainPerson = null;
  if (!main && others.length > 0) {
    // Nobody else has video: show who you are talking to, and yourself small.
    mainPerson = others.find(p => p.participantId === speakerId) || others[0];
  } else if (!main) {
    // On your own (waiting for others): your own camera, or your own screen.
    main = localCam || tracks[0] || null;
  }

  const pip = localCam && localCam !== main ? localCam : null;
  const strip = tracks.filter(t => t !== main && t !== pip);
  return { main, mainPerson, pip, strip };
}

/**
 * Fill the box (cropping) when the video is the same way round as the box;
 * fit it inside (bars) when it isn't, so a phone held upright isn't cut down
 * to a sliver of face in a landscape window. On a phone a camera always
 * fills the screen, as phone calls do (`fill`). A screen is never cropped,
 * and neither is your own camera when it fills the screen (alone, or tapped):
 * you are checking your framing, and a crop looks zoomed in (v2.144.1).
 */
export function fitFor(video, box, isScreen, { fill = false, self = false } = {}) {
  if (isScreen || self) return 'contain';
  if (fill) return 'cover';
  if (!video?.w || !video?.h || !box?.w || !box?.h) return 'contain';
  return (video.w >= video.h) === (box.w >= box.h) ? 'cover' : 'contain';
}

/**
 * LiveKit room options for calls. adaptiveStream sends each viewer only the
 * size they show; dynacast stops sending layers nobody is watching.
 *
 * A phone asks for 960x720, landscape-shaped, with no aspect ratio (v2.144.2).
 * Phone browsers read camera sizes in the sensor's own landscape terms and
 * turn the picture to match how the phone is held, so a phone held upright
 * sends upright video. Asking for an upright size (v2.144.0's 720x1280,
 * v2.144.1's 720x960) came out sideways on real phones. 4:3 is the sensor's
 * shape, so it isn't cropped. `uprightRetry()` covers a browser that does not
 * turn the picture.
 */
export function callRoomOptions({ isMobile = false, micId, cameraId } = {}) {
  return {
    adaptiveStream: true,
    dynacast: true,
    audioCaptureDefaults: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      deviceId: micId && micId !== 'default' ? micId : undefined,
    },
    videoCaptureDefaults: {
      resolution: isMobile
        ? { width: 960, height: 720, frameRate: 30 }
        : { width: 1280, height: 720, frameRate: 30 },
      deviceId: cameraId && cameraId !== 'default' ? cameraId : undefined,
    },
  };
}

/**
 * The camera size to ask for again when a phone held upright is sending a
 * sideways picture, or null when it isn't (v2.144.2). Asked once per track.
 * @param {{w:number,h:number}|null} frame  the picture actually arriving
 * @param {boolean} upright                 the screen is taller than wide
 * @param {{width:number,height:number}} asked the size first asked for
 */
export function uprightRetry(frame, upright, asked) {
  if (!upright || !frame?.w || !frame?.h || frame.h >= frame.w) return null;
  return { width: asked.height, height: asked.width, frameRate: asked.frameRate };
}
