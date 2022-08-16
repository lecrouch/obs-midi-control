// MIDI Control
const easymidi = require('easymidi');
// VLC Control
const vlcPlayer = require('vlc-simple-player');
const vlcController = require("vlc-client");
// OBS Control
const OBSWebSocket = require('obs-websocket-js');
// Keymap & Settings Control
const { readFileSync } = require(`fs`);

const midiControllerName = `Arturia BeatStep`;
const OBS_CONTROLLER = new OBSWebSocket();
let VLC_CONTROLLER;

const vlcOptions = {
    arguments: [
        `--loop`,
        `--no-video-title`,
        `--random`,
        `--no-audio`,
        `--width=1920`,
        `--height=1080`,
        `--aspect-ratio=16x9`,
    ],
    password: `vlc`,
    port: 8080
};

let BPM = 128;
let MASTER_LOOP = false;
let ROTARY_VALUES = {};
let VLC_PLAYLIST_INDEX = 0;
const VLC_PLAYLISTS = [
    `/Users/juliancrouch/StreamingAssets/video-clips/vj.m3u`,
    `/Users/juliancrouch/StreamingAssets/video-clips/tunnels.m3u`,
    `/Users/juliancrouch/StreamingAssets/video-clips/randos.m3u`,
    `/Users/juliancrouch/StreamingAssets/video-clips/four-color.m3u`,
    `/Users/juliancrouch/StreamingAssets/video-clips/switzon-clips.m3u`,
    `/Users/juliancrouch/StreamingAssets/video-clips/brainfeeder-vj.m3u`,
];
const LOOPING_SCENES = [
    `HORIZ LUT STRIPE -- GOPRO`,
    `VERT LUT STRIPE -- GOPRO`,
    `DUB HORIZ LUT STRIPE -- GOPRO`,
    `DUB VERT LUT STRIPE -- GOPRO`,
    `LUT RESIZE SPIRAL -- GOPRO`,
    `LUTS -- GOPRO`,
    `STROBE -- GOPRO`,
    `WINTERGREEN ZIPPER -- GOPRO`,
    `WINTERGREEN ZIPPER 2 -- GOPRO`,
    `WINTERGREEN ZIPPER CHAOS -- GOPRO`,
    `RANDOM BOX -- GOPRO`,
    `SIDE BOXES -- GOPRO`,
    `SCROLLING SIDES -- GOPRO`,
    `CENTER POP -- GOPRO`,
    `CENTER POP 2 -- GOPRO`,
    `CENTER POP CHAOS -- GOPRO`,
    `INTERLACED -- GOPRO`
];

let vlcLoopControl = {
    fastForwardSeconds: 3,
    nextTrackLoopCounter: 7,
    fastForwardLoopCounter: 5
}

const keyMap = JSON.parse(readFileSync(`midi_key_map.json`));

const obsOptions = {
    address: 'localhost:4444',
    password: 'shytiegr'
};

// Unused now, but will build out a "vlc kill switch" in the future
async function killVlcLoops() {
    vlcLoopControl.fastForwardSeconds = 0;
    vlcLoopControl.nextTrackLoopCounter = 0;
    vlcLoopControl.fastForwardLoopCounter = 0;
    await pauseVlcPlayback();
}

async function establishObsConnection() {
    // const connection = await OBS.connect(obsOptions);
    await OBS_CONTROLLER.connect(obsOptions);
    console.log(`Success! We're connected & authenticated.`);
}

async function executeMidiKeyTrigger(hotkeyData) {
    // if (hotkeyData.requresLoop) {
    //     MASTER_LOOP = true;
    // }
    MASTER_LOOP = false;

    if (hotkeyData.key) {
        await selectObsSceneByHotkey(hotkeyData.key, hotkeyData.keyModifiers);
        console.log(`Request sent to change OBS scene to "${hotkeyData.details.sceneName}" via hotkey: ${hotkeyData.key}`);
    } else {
        await selectObsSceneByName(hotkeyData.details.sceneName);
        console.log(`Request sent to change OBS scene to "${hotkeyData.details.sceneName}" via scene name`);
    }
    if (VLC_CONTROLLER && hotkeyData.vlc) {
        await vlcVideoChop();
    }
}

async function executeMidiRotaryController(hotkeyData, midiString, value) {
    let modifier = 0;
    let newValue = false;

    if ( ! (midiString in ROTARY_VALUES)) {
        ROTARY_VALUES[midiString] = 64;
        newValue = true;
    }

    if (ROTARY_VALUES[midiString] < value) {
        if ( ! newValue) {
            modifier = 1;
        }
    } else {
        if ( ! newValue) {
            modifier = -1;
        }
    }

    if ( ! newValue) {
        ROTARY_VALUES[midiString] = value;
    }

    switch (hotkeyData.operation) {
        case `BPM`: {
            BPM += modifier;
            console.log(`BPM Set To: ${BPM}, (${60/BPM} seconds)`);
        }
        break;

        case `fastForwardSeconds`: {
            vlcLoopControl.fastForwardSeconds += modifier;
            console.log(`VLC Fast Forward Seconds Set To: ${vlcLoopControl.fastForwardSeconds}`);
            break;
        }

        case `nextTrackLoopCounter`: {
            vlcLoopControl.nextTrackLoopCounter += modifier;
            console.log(`VLC Next Track Loop Counter Set To: ${vlcLoopControl.nextTrackLoopCounter} Loops`);
            break;
        }

        case `fastForwardLoopCounter`: {
            vlcLoopControl.fastForwardLoopCounter += modifier;
            console.log(`VLC Fast Forward Loop Counter Set To: ${vlcLoopControl.fastForwardLoopCounter} Loops`);
            break;
        }

        case `vlcPlaylistSelect`: {
            let arraySize = VLC_PLAYLISTS.length;
            VLC_PLAYLIST_INDEX += modifier;
            if (VLC_PLAYLIST_INDEX < 0) {
                VLC_PLAYLIST_INDEX = arraySize;
            }
            if (VLC_PLAYLIST_INDEX > arraySize) {
                VLC_PLAYLIST_INDEX = 0;
            }

            let oldPlaylist = await VLC_CONTROLLER.getPlaylist();
            // let oldPlaylistIds = oldPlaylist.map( item => {
            //     return item.id;
            // });
            await VLC_CONTROLLER.playFile(VLC_PLAYLISTS[VLC_PLAYLIST_INDEX], {noaudio: true});
            await pauseVlcPlayback();
            // for (let i = 0; i < oldPlaylistIds.length; i++) {
            //     await VLC_CONTROLLER.removeFromPlaylist(oldPlaylistIds[i]);
            // }
            await Promise.all(oldPlaylist.map (ele => {
                VLC_CONTROLLER.removeFromPlaylist(ele.id);
            }));
            console.log(`Playlist: ${VLC_PLAYLISTS[VLC_PLAYLIST_INDEX]} loaded!`);
            break;
        }

        default: {
            console.log(`No Rotary Encoder Operation Defined`);
        }
    }
}

function sleep(seconds ) {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

function setupMIDI(controllerName) {
    var inputs = easymidi.getInputs();
    var outputs = easymidi.getOutputs();
    console.log('Inputs found:', inputs);
    console.log('Outputs found:', outputs);

    console.log('Looking for proper input/output...');
    for (i = 0, input = null; input = inputs[i++];) {
        if (~input.indexOf(controllerName)) {
            console.log(`Found matching input "${input}" at index ${i - 1}.`);
            global.input = new easymidi.Input(input);
            break;
        }
    }

    if (!global.input) {
        console.error(`No controller matching "${controllerName}" was found. Quitting...`);
        process.exit();
        return;
    }
}

async function initializeVLC(filepath, options) {
    new vlcPlayer(filepath, options);

    const controller = await new vlcController.Client({
        ip: "localhost",
        port: 8080,
        password: `vlc`
    });

    await sleep(2);
    await controller.pause();
    return controller;
}

async function pauseVlcPlayback() {
    while (await VLC_CONTROLLER.isPlaying()) {
        console.log(`Attempting pause.`);
        await VLC_CONTROLLER.togglePlay();
    }
    console.log(`Paused.`);
}

async function nextVlcTrack(sleepDuration) {
    await sleep(sleepDuration);
    console.log(`Slept for ${sleepDuration} seconds`);
    await VLC_CONTROLLER.next();
    console.log(`skipped to next track`);
}

async function randomVlcSkipTracks() {
    for (let i = 0; i < getRandomInt(1, 5); i++) {
        await VLC_CONTROLLER.next();
        await sleep(0.2);
    }
    await VLC_CONTROLLER.pause();
}


async function fastForwardVlcTrack(fastForwardSeconds, sleepDuration) {
    await sleep(sleepDuration);
    console.log(`Slept for ${sleepDuration} seconds`);
    await VLC_CONTROLLER.jumpForward(fastForwardSeconds);
    console.log(`skipped forward ${fastForwardSeconds} seconds`);
}


async function vlcVideoChop() {
    console.log(`Priming new starting point`);
    // await randomVlcSkipTracks();
    console.log(`starting chop loop`);
    for (let i = 0; i < vlcLoopControl.nextTrackLoopCounter; i++) {
        await nextVlcTrack( 60 / BPM);
        for (let j = 0; j < vlcLoopControl.fastForwardLoopCounter; j++) {
            await fastForwardVlcTrack( vlcLoopControl.fastForwardSeconds, 60 / BPM);
        }
    }
    // await pauseVlcPlayback();
    await VLC_CONTROLLER.pause();
    console.log(`chop loop done.`);
    await executeMidiKeyTrigger(keyMap.defaultScene);
}

function registerObsListeners() {
    OBS_CONTROLLER.on('SwitchScenes', data => {
        console.log(`New Active Scene: ${data.sceneName}`);
        if (LOOPING_SCENES.includes(data.sceneName)) {
            executeLoopingScene(data);
        }
    });
    OBS_CONTROLLER.on('error', err => {
        console.error('socket error:', err);
    });
}

async function selectObsSceneByHotkey(key, keyModifiers) {
    await OBS_CONTROLLER.send(`TriggerHotkeyBySequence`, {
        keyId: key,
        keyModifiers: keyModifiers
    });
}

async function selectObsSceneByName(sceneName) {
    await OBS_CONTROLLER.send(`SetCurrentScene`, {
        'scene-name': sceneName
    });
}

function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1) + min);
}

async function getCurrentScene() {
    return await OBS_CONTROLLER.send(`GetCurrentScene`);
}

function getRelevantSceneItems(sceneItems, partialName) {
    let names = sceneItems.map(item => {
        if (item.type === `scene` && item.name.includes(partialName)) {
            return item.name;
        }
    });
    return names.filter( name => {
        return typeof name === `string`;
    });
}

async function toggleAllOffAndReset(sceneName, itemNames) {
    for (const name of itemNames) {
        await OBS_CONTROLLER.send(`SetSceneItemProperties`, {
            'scene-name': sceneName,
            item: {
                name: name
            },
            visible: false,
            crop: {
                top: 0,
                bottom: 0,
                left: 0,
                right: 0
            },
            position: {
                x: 0,
                y: 0
            }
        });
    }
}

async function resetSceneItem(scene, itemName) {
    await OBS_CONTROLLER.send(`SetSceneItemProperties`, {
        'scene-name': scene.name,
        item: {
            name: itemName
        },
        crop: {
            top:  0,
            bottom: 0,
            left: 0,
            right: 0
        },
        position: {
            x: 0,
            y: 0
        },
        visible: true
    });
}

async function lutCycle(scene) {
    const itemNames = getRelevantSceneItems(scene.sources, `gopro`)
    await toggleAllOffAndReset(scene.name, itemNames);
    let lastName = ``;
    while (MASTER_LOOP) {
        for (let j = 0; j < itemNames.length; j++) {
            await OBS_CONTROLLER.send(`SetSceneItemProperties`, {
                'scene-name': scene.name,
                item: {
                    name: itemNames[j]
                },
                visible: true
            });
            if (lastName) {
                await OBS_CONTROLLER.send(`SetSceneItemProperties`, {
                    'scene-name': scene.name,
                    item: {
                        name: lastName
                    },
                    visible: false
                });
            }
            lastName = itemNames[j];
            await sleep(60 / BPM);
        }
    }
}

async function transformSpin(scene) {
    while (MASTER_LOOP) {
        // console.log(`cropping top 540:, y: 540`);
        await OBS_CONTROLLER.send(`SetSceneItemProperties`, {
            'scene-name': scene.name,
            item: {
                name: `gopro - neon`
            },
            crop: {
                top: 540,
                bottom: 0,
                left: 0,
                right: 0
            },
            position: {
                x: 0,
                y: 540
            }
        });
        await sleep(60 / BPM);
        // console.log(`cropping right: 960, x: -960`);
        await OBS_CONTROLLER.send(`SetSceneItemProperties`, {
            'scene-name': scene.name,
            item: {
                name: `gopro - neon`
            },
            crop: {
                top: 0,
                bottom: 0,
                left: 0,
                right: 960
            },
            position: {
                x: 0,
                y: 0
            }
        });
        await sleep(60 / BPM);
        // console.log(`cropping bottom: 540, y: 0`);
        await OBS_CONTROLLER.send(`SetSceneItemProperties`, {
            'scene-name': scene.name,
            item: {
                name: `gopro - neon`
            },
            crop: {
                top: 0,
                bottom: 540,
                left: 0,
                right: 0
            },
            position: {
                x: 0,
                y: 0
            }
        });
        await sleep(60 / BPM);
        // console.log(`cropping left: 960, x: 960`);
        await OBS_CONTROLLER.send(`SetSceneItemProperties`, {
            'scene-name': scene.name,
            item: {
                name: `gopro - neon`
            },
            crop: {
                top: 0,
                bottom: 0,
                left: 960,
                right: 0
            },
            position: {
                x: 960,
                y: 0
            }
        });
        await sleep(60 / BPM);

        if ( !  MASTER_LOOP) {
            await resetSceneItem(scene, `gopro - neon`);
        }
    }
}

async function zipperFlow(scene) {
    while (MASTER_LOOP) {
        for (let i = 1; i < 4; i++) {
            let topOffset = i * -100;
            let bottomOffset = i * 100;
            //top
            await transformScene(scene, `gopro - wintergreen 2`, 240, topOffset, 0, 0, 240, 1440);
            await transformScene(scene, `gopro - wintergreen 4`, 720, topOffset, 0, 0, 720, 960);
            await transformScene(scene, `gopro - wintergreen 6`, 1200, topOffset, 0, 0, 1200, 480);
            await transformScene(scene, `gopro - wintergreen 8`, 1680, topOffset, 0, 0, 1680, 0);
            await sleep(60 / BPM);
            //bottom
            await transformScene(scene, `gopro - wintergreen 1`, 0, bottomOffset, 0, 0, 0, 1680);
            await transformScene(scene, `gopro - wintergreen 3`, 480, bottomOffset, 0, 0, 480, 1200);
            await transformScene(scene, `gopro - wintergreen 5`, 960, bottomOffset, 0, 0, 960, 720);
            await transformScene(scene, `gopro - wintergreen 7`, 1440, bottomOffset, 0, 0, 1440, 240);
            await sleep(60 / BPM);
            // all
            await transformScene(scene, `gopro - wintergreen 1`, 0, bottomOffset, 0, 0, 0, 1680);
            await transformScene(scene, `gopro - wintergreen 2`, 240, topOffset, 0, 0, 240, 1440);
            await transformScene(scene, `gopro - wintergreen 3`, 480, bottomOffset, 0, 0, 480, 1200);
            await transformScene(scene, `gopro - wintergreen 4`, 720, topOffset, 0, 0, 720, 960);
            await transformScene(scene, `gopro - wintergreen 5`, 960, bottomOffset, 0, 0, 960, 720);
            await transformScene(scene, `gopro - wintergreen 6`, 1200, topOffset, 0, 0, 1200, 480);
            await transformScene(scene, `gopro - wintergreen 7`, 1440, bottomOffset, 0, 0, 1440, 240);
            await transformScene(scene, `gopro - wintergreen 8`, 1680, topOffset, 0, 0, 1680, 0);
            await sleep(60 / BPM);
            // // one way
            // await transformScene(scene, `gopro - wintergreen`, 0 - 100, bottomOffset, 0, 0, 0, 1680);
            // await transformScene(scene, `gopro - wintergreen 2`, 240 + 100, topOffset, 0, 0, 240, 1440);
            // await transformScene(scene, `gopro - wintergreen 3`, 480 - 100, bottomOffset, 0, 0, 480, 1200);
            // await transformScene(scene, `gopro - wintergreen 4`, 720 + 100, topOffset, 0, 0, 720, 960);
            // await transformScene(scene, `gopro - wintergreen 5`, 960 - 100, bottomOffset, 0, 0, 960, 720);
            // await transformScene(scene, `gopro - wintergreen 6`, 1200 + 100, topOffset, 0, 0, 1200, 480);
            // await transformScene(scene, `gopro - wintergreen 7`, 1440 - 100, bottomOffset, 0, 0, 1440, 240);
            // await transformScene(scene, `gopro - wintergreen 8`, 1680 + 100, topOffset, 0, 0, 1680, 0);
            // await sleep(60 / BPM);
            // // another way
            // await transformScene(scene, `gopro - wintergreen`, 0 + 100, bottomOffset, 0, 0, 0, 1680);
            // await transformScene(scene, `gopro - wintergreen 2`, 240 - 100, topOffset, 0, 0, 240, 1440);
            // await transformScene(scene, `gopro - wintergreen 3`, 480 + 100, bottomOffset, 0, 0, 480, 1200);
            // await transformScene(scene, `gopro - wintergreen 4`, 720 - 100, topOffset, 0, 0, 720, 960);
            // await transformScene(scene, `gopro - wintergreen 5`, 960 + 100, bottomOffset, 0, 0, 960, 720);
            // await transformScene(scene, `gopro - wintergreen 6`, 1200 - 100, topOffset, 0, 0, 1200, 480);
            // await transformScene(scene, `gopro - wintergreen 7`, 1440 + 100, bottomOffset, 0, 0, 1440, 240);
            // await transformScene(scene, `gopro - wintergreen 8`, 1680 - 100, topOffset, 0, 0, 1680, 0);
            // await sleep(60 / BPM);
            // // all back
            // await transformScene(scene, `gopro - wintergreen`, 0, bottomOffset, 0, 0, 0, 1680);
            // await transformScene(scene, `gopro - wintergreen 2`, 240, topOffset, 0, 0, 240, 1440);
            // await transformScene(scene, `gopro - wintergreen 3`, 480, bottomOffset, 0, 0, 480, 1200);
            // await transformScene(scene, `gopro - wintergreen 4`, 720, topOffset, 0, 0, 720, 960);
            // await transformScene(scene, `gopro - wintergreen 5`, 960, bottomOffset, 0, 0, 960, 720);
            // await transformScene(scene, `gopro - wintergreen 6`, 1200, topOffset, 0, 0, 1200, 480);
            // await transformScene(scene, `gopro - wintergreen 7`, 1440, bottomOffset, 0, 0, 1440, 240);
            // await transformScene(scene, `gopro - wintergreen 8`, 1680, topOffset, 0, 0, 1680, 0);
            // await sleep(60 / BPM);
        }
        if ( ! MASTER_LOOP) {
            await resetSceneItem(scene, `gopro - wintergreen 1`);
            await resetSceneItem(scene, `gopro - wintergreen 2`);
            await resetSceneItem(scene, `gopro - wintergreen 3`);
            await resetSceneItem(scene, `gopro - wintergreen 4`);
            await resetSceneItem(scene, `gopro - wintergreen 5`);
            await resetSceneItem(scene, `gopro - wintergreen 6`);
            await resetSceneItem(scene, `gopro - wintergreen 7`);
            await resetSceneItem(scene, `gopro - wintergreen 8`);
        }
    }
}

async function zipperFlow2(scene) {
    while (MASTER_LOOP) {
        for (let i = 1; i < 9; i++) {
            let topOffset = i * -100;
            let bottomOffset = i * 100;
            //top
            await transformScene(scene, `gopro - wintergreen 2`, 240, 0, 0, bottomOffset, 240, 1440);
            await transformScene(scene, `gopro - wintergreen 4`, 720, 0, 0, bottomOffset, 720, 960);
            await transformScene(scene, `gopro - wintergreen 6`, 1200, 0, 0, bottomOffset, 1200, 480);
            await transformScene(scene, `gopro - wintergreen 8`, 1680, 0, 0, bottomOffset, 1680, 0);
            await sleep(60 / BPM);
            //bottom
            await transformScene(scene, `gopro - wintergreen 1`, 0, bottomOffset, bottomOffset, 0, 0, 1680);
            await transformScene(scene, `gopro - wintergreen 3`, 480, bottomOffset, bottomOffset, 0, 480, 1200);
            await transformScene(scene, `gopro - wintergreen 5`, 960, bottomOffset, bottomOffset, 0, 960, 720);
            await transformScene(scene, `gopro - wintergreen 7`, 1440, bottomOffset, bottomOffset, 0, 1440, 240);
            await sleep(60 / BPM);
            // all
            await transformScene(scene, `gopro - wintergreen 1`, 0, bottomOffset, bottomOffset, 0, 0, 1680);
            await transformScene(scene, `gopro - wintergreen 2`, 240, 0, 0, bottomOffset, 240, 1440);
            await transformScene(scene, `gopro - wintergreen 3`, 480, bottomOffset, bottomOffset, 0, 480, 1200);
            await transformScene(scene, `gopro - wintergreen 4`, 720, 0, 0, bottomOffset, 720, 960);
            await transformScene(scene, `gopro - wintergreen 5`, 960, bottomOffset, bottomOffset, 0, 960, 720);
            await transformScene(scene, `gopro - wintergreen 6`, 1200, 0, 0, bottomOffset, 1200, 480);
            await transformScene(scene, `gopro - wintergreen 7`, 1440, bottomOffset, bottomOffset, 0, 1440, 240);
            await transformScene(scene, `gopro - wintergreen 8`, 1680, 0, 0, bottomOffset, 1680, 0);
            await sleep(60 / BPM);
        }
        if ( ! MASTER_LOOP) {
            await resetSceneItem(scene, `gopro - wintergreen 1`);
            await resetSceneItem(scene, `gopro - wintergreen 2`);
            await resetSceneItem(scene, `gopro - wintergreen 3`);
            await resetSceneItem(scene, `gopro - wintergreen 4`);
            await resetSceneItem(scene, `gopro - wintergreen 5`);
            await resetSceneItem(scene, `gopro - wintergreen 6`);
            await resetSceneItem(scene, `gopro - wintergreen 7`);
            await resetSceneItem(scene, `gopro - wintergreen 8`);
        }
    }
}

async function zipperFlowChaos(scene) {
    while (MASTER_LOOP) {
        for (let i = 1; i < 4; i++) {
            let topOffset = i * -100;
            let bottomOffset = i * 100;
            //top
            await transformScene(scene, `gopro - wintergreen 2`, 240, topOffset, 0, 0, 240, 1440);
            await transformScene(scene, `gopro - wintergreen 4`, 720, topOffset, 0, 0, 720, 960);
            await transformScene(scene, `gopro - wintergreen 6`, 1200, topOffset, 0, 0, 1200, 480);
            await transformScene(scene, `gopro - wintergreen 8`, 1680, topOffset, 0, 0, 1680, 0);
            await sleep(60 / BPM);
            //bottom
            await transformScene(scene, `gopro - wintergreen 1`, 0, bottomOffset, 0, 0, 0, 1680);
            await transformScene(scene, `gopro - wintergreen 3`, 480, bottomOffset, 0, 0, 480, 1200);
            await transformScene(scene, `gopro - wintergreen 5`, 960, bottomOffset, 0, 0, 960, 720);
            await transformScene(scene, `gopro - wintergreen 7`, 1440, bottomOffset, 0, 0, 1440, 240);
            await sleep(60 / BPM);
            // all
            await transformScene(scene, `gopro - wintergreen 1`, 0, bottomOffset, 0, 0, 0, 1680);
            await transformScene(scene, `gopro - wintergreen 2`, 240, topOffset, 0, 0, 240, 1440);
            await transformScene(scene, `gopro - wintergreen 3`, 480, bottomOffset, 0, 0, 480, 1200);
            await transformScene(scene, `gopro - wintergreen 4`, 720, topOffset, 0, 0, 720, 960);
            await transformScene(scene, `gopro - wintergreen 5`, 960, bottomOffset, 0, 0, 960, 720);
            await transformScene(scene, `gopro - wintergreen 6`, 1200, topOffset, 0, 0, 1200, 480);
            await transformScene(scene, `gopro - wintergreen 7`, 1440, bottomOffset, 0, 0, 1440, 240);
            await transformScene(scene, `gopro - wintergreen 8`, 1680, topOffset, 0, 0, 1680, 0);
            await sleep(60 / BPM);
            // one way
            await transformScene(scene, `gopro - wintergreen 1`, 0, bottomOffset, 0, 0, 0 - 100, 1680);
            await transformScene(scene, `gopro - wintergreen 2`, 240, topOffset, 0, 0, 240 + 100, 1440);
            await transformScene(scene, `gopro - wintergreen 3`, 480, bottomOffset, 0, 0, 480 - 100, 1200);
            await transformScene(scene, `gopro - wintergreen 4`, 720, topOffset, 0, 0, 720 + 100, 960);
            await transformScene(scene, `gopro - wintergreen 5`, 960, bottomOffset, 0, 0, 960 - 100, 720);
            await transformScene(scene, `gopro - wintergreen 6`, 1200, topOffset, 0, 0, 1200 + 100, 480);
            await transformScene(scene, `gopro - wintergreen 7`, 1440, bottomOffset, 0, 0, 1440 - 100, 240);
            await transformScene(scene, `gopro - wintergreen 8`, 1680, topOffset, 0, 0, 1680 + 100, 0);
            await sleep(60 / BPM);
            // another way
            await transformScene(scene, `gopro - wintergreen 1`, 0, bottomOffset, 0, 0, 0 + 100, 1680);
            await transformScene(scene, `gopro - wintergreen 2`, 240, topOffset, 0, 0, 240 - 100, 1440);
            await transformScene(scene, `gopro - wintergreen 3`, 480, bottomOffset, 0, 0, 480 + 100, 1200);
            await transformScene(scene, `gopro - wintergreen 4`, 720, topOffset, 0, 0, 720 - 100, 960);
            await transformScene(scene, `gopro - wintergreen 5`, 960, bottomOffset, 0, 0, 960 + 100, 720);
            await transformScene(scene, `gopro - wintergreen 6`, 1200, topOffset, 0, 0, 1200 - 100, 480);
            await transformScene(scene, `gopro - wintergreen 7`, 1440, bottomOffset, 0, 0, 1440 + 100, 240);
            await transformScene(scene, `gopro - wintergreen 8`, 1680, topOffset, 0, 0, 1680 - 100, 0);
            await sleep(60 / BPM);
            // all back
            await transformScene(scene, `gopro - wintergreen 1`, 0, bottomOffset, 0, 0, 0, 1680);
            await transformScene(scene, `gopro - wintergreen 2`, 240, topOffset, 0, 0, 240, 1440);
            await transformScene(scene, `gopro - wintergreen 3`, 480, bottomOffset, 0, 0, 480, 1200);
            await transformScene(scene, `gopro - wintergreen 4`, 720, topOffset, 0, 0, 720, 960);
            await transformScene(scene, `gopro - wintergreen 5`, 960, bottomOffset, 0, 0, 960, 720);
            await transformScene(scene, `gopro - wintergreen 6`, 1200, topOffset, 0, 0, 1200, 480);
            await transformScene(scene, `gopro - wintergreen 7`, 1440, bottomOffset, 0, 0, 1440, 240);
            await transformScene(scene, `gopro - wintergreen 8`, 1680, topOffset, 0, 0, 1680, 0);
            await sleep(60 / BPM);
        }
        if ( ! MASTER_LOOP) {
            await resetSceneItem(scene, `gopro - wintergreen 1`);
            await resetSceneItem(scene, `gopro - wintergreen 2`);
            await resetSceneItem(scene, `gopro - wintergreen 3`);
            await resetSceneItem(scene, `gopro - wintergreen 4`);
            await resetSceneItem(scene, `gopro - wintergreen 5`);
            await resetSceneItem(scene, `gopro - wintergreen 6`);
            await resetSceneItem(scene, `gopro - wintergreen 7`);
            await resetSceneItem(scene, `gopro - wintergreen 8`);
        }
    }
}

// async function vertZipperFlow(scene) {
//     while (MASTER_LOOP) {
//         for (let i = 1; i < 4; i++) {
//             let leftOffest = i * -100;
//             let rightOffset = i * 100;
//             //left
//             await transformScene(scene, `gopro - wintergreen 2`, leftOffest, 240, 0, 0, 240, 1440);
//             await transformScene(scene, `gopro - wintergreen 4`, leftOffest, 720, 0, 0, 720, 960);
//             await transformScene(scene, `gopro - wintergreen 6`, leftOffest, 1200, 0, 0, 1200, 480);
//             await transformScene(scene, `gopro - wintergreen 8`, leftOffest, 1680, 0, 0, 1680, 0);
//
//             await transformScene(scene, `gopro - wintergreen 2`, 240, leftOffest, 0, 0, 240, 1440);
//             await transformScene(scene, `gopro - wintergreen 4`, 720, leftOffest, 0, 0, 720, 960);
//             await transformScene(scene, `gopro - wintergreen 6`, 1200, leftOffest, 0, 0, 1200, 480);
//             await transformScene(scene, `gopro - wintergreen 8`, 1680, leftOffest, 0, 0, 1680, 0);
//             await sleep(60 / BPM);
//             //right
//             await transformScene(scene, `gopro - wintergreen 2`, leftOffest, 240, 0, 0, 240, 1440);
//             await transformScene(scene, `gopro - wintergreen 4`, leftOffest, 720, 0, 0, 720, 960);
//             await transformScene(scene, `gopro - wintergreen 6`, leftOffest, 1200, 0, 0, 1200, 480);
//             await transformScene(scene, `gopro - wintergreen 8`, leftOffest, 1680, 0, 0, 1680, 0);
//
//             await transformScene(scene, `gopro - wintergreen`, 0, rightOffset, 0, 0, 0, 1680);
//             await transformScene(scene, `gopro - wintergreen 3`, 480, rightOffset, 0, 0, 480, 1200);
//             await transformScene(scene, `gopro - wintergreen 5`, 960, rightOffset, 0, 0, 960, 720);
//             await transformScene(scene, `gopro - wintergreen 7`, 1440, rightOffset, 0, 0, 1440, 240);
//             await sleep(60 / BPM);
//             // all
//             await transformScene(scene, `gopro - wintergreen`, 0, rightOffset, 0, 0, 0, 1680);
//             await transformScene(scene, `gopro - wintergreen 2`, 240, leftOffest, 0, 0, 240, 1440);
//             await transformScene(scene, `gopro - wintergreen 3`, 480, rightOffset, 0, 0, 480, 1200);
//             await transformScene(scene, `gopro - wintergreen 4`, 720, leftOffest, 0, 0, 720, 960);
//             await transformScene(scene, `gopro - wintergreen 5`, 960, rightOffset, 0, 0, 960, 720);
//             await transformScene(scene, `gopro - wintergreen 6`, 1200, leftOffest, 0, 0, 1200, 480);
//             await transformScene(scene, `gopro - wintergreen 7`, 1440, rightOffset, 0, 0, 1440, 240);
//             await transformScene(scene, `gopro - wintergreen 8`, 1680, leftOffest, 0, 0, 1680, 0);
//             await sleep(60 / BPM);
//             // // one way
//             // await transformScene(scene, `gopro - wintergreen`, 0 - 100, rightOffset, 0, 0, 0, 1680);
//             // await transformScene(scene, `gopro - wintergreen 2`, 240 + 100, leftOffest, 0, 0, 240, 1440);
//             // await transformScene(scene, `gopro - wintergreen 3`, 480 - 100, rightOffset, 0, 0, 480, 1200);
//             // await transformScene(scene, `gopro - wintergreen 4`, 720 + 100, leftOffest, 0, 0, 720, 960);
//             // await transformScene(scene, `gopro - wintergreen 5`, 960 - 100, rightOffset, 0, 0, 960, 720);
//             // await transformScene(scene, `gopro - wintergreen 6`, 1200 + 100, leftOffest, 0, 0, 1200, 480);
//             // await transformScene(scene, `gopro - wintergreen 7`, 1440 - 100, rightOffset, 0, 0, 1440, 240);
//             // await transformScene(scene, `gopro - wintergreen 8`, 1680 + 100, leftOffest, 0, 0, 1680, 0);
//             // await sleep(60 / BPM);
//             // // another way
//             // await transformScene(scene, `gopro - wintergreen`, 0 + 100, rightOffset, 0, 0, 0, 1680);
//             // await transformScene(scene, `gopro - wintergreen 2`, 240 - 100, leftOffest, 0, 0, 240, 1440);
//             // await transformScene(scene, `gopro - wintergreen 3`, 480 + 100, rightOffset, 0, 0, 480, 1200);
//             // await transformScene(scene, `gopro - wintergreen 4`, 720 - 100, leftOffest, 0, 0, 720, 960);
//             // await transformScene(scene, `gopro - wintergreen 5`, 960 + 100, rightOffset, 0, 0, 960, 720);
//             // await transformScene(scene, `gopro - wintergreen 6`, 1200 - 100, leftOffest, 0, 0, 1200, 480);
//             // await transformScene(scene, `gopro - wintergreen 7`, 1440 + 100, rightOffset, 0, 0, 1440, 240);
//             // await transformScene(scene, `gopro - wintergreen 8`, 1680 - 100, leftOffest, 0, 0, 1680, 0);
//             // await sleep(60 / BPM);
//             // // all back
//             // await transformScene(scene, `gopro - wintergreen`, 0, rightOffset, 0, 0, 0, 1680);
//             // await transformScene(scene, `gopro - wintergreen 2`, 240, leftOffest, 0, 0, 240, 1440);
//             // await transformScene(scene, `gopro - wintergreen 3`, 480, rightOffset, 0, 0, 480, 1200);
//             // await transformScene(scene, `gopro - wintergreen 4`, 720, leftOffest, 0, 0, 720, 960);
//             // await transformScene(scene, `gopro - wintergreen 5`, 960, rightOffset, 0, 0, 960, 720);
//             // await transformScene(scene, `gopro - wintergreen 6`, 1200, leftOffest, 0, 0, 1200, 480);
//             // await transformScene(scene, `gopro - wintergreen 7`, 1440, rightOffset, 0, 0, 1440, 240);
//             // await transformScene(scene, `gopro - wintergreen 8`, 1680, leftOffest, 0, 0, 1680, 0);
//             // await sleep(60 / BPM);
//         }
//         if ( ! MASTER_LOOP) {
//             await resetSceneItem(scene, `gopro - wintergreen`);
//             await resetSceneItem(scene, `gopro - wintergreen 2`);
//             await resetSceneItem(scene, `gopro - wintergreen 3`);
//             await resetSceneItem(scene, `gopro - wintergreen 4`);
//             await resetSceneItem(scene, `gopro - wintergreen 5`);
//             await resetSceneItem(scene, `gopro - wintergreen 6`);
//             await resetSceneItem(scene, `gopro - wintergreen 7`);
//             await resetSceneItem(scene, `gopro - wintergreen 8`);
//         }
//     }
// }

async function lutHorizStripe(scene) {
    const size = 135;
    while (MASTER_LOOP) {
        for (let i = 0; i < 8; i++ ) {
            await OBS_CONTROLLER.send(`SetSceneItemProperties`, {
                'scene-name': scene.name,
                item: {
                    name: `gopro - neon`
                },
                crop: {
                    top: i * size,
                    bottom: 1080 - ((i + 1) * size),
                    left: 0,
                    right: 0
                },
                position: {
                    x: 0,
                    y: i * size
                }
            });
            await sleep(60 / BPM);
        }
        for (let i = 6; i > 0; i-- ) {
            await OBS_CONTROLLER.send(`SetSceneItemProperties`, {
                'scene-name': scene.name,
                item: {
                    name: `gopro - neon`
                },
                crop: {
                    top: i * size,
                    bottom: 1080 - ((i + 1) * size),
                    left: 0,
                    right: 0
                },
                position: {
                    x: 0,
                    y: i * size
                }
            });
            await sleep(.60 / BPM);
        }
        if ( !  MASTER_LOOP) {
            await resetSceneItem(scene, `gopro - neon`);
        }
    }
}

async function randomBox(scene) {
    while (MASTER_LOOP) {
        let cropTop = getRandomInt(50, 1080 / 2);
        let cropBot = getRandomInt(50, 1080 / 2);
        let cropLeft = getRandomInt(50, 1920 / 2);
        let cropRight = getRandomInt(50, 1920 / 2);
        let xpos = cropLeft;
        let ypos = cropTop;
        await transformScene(scene, `gopro - inverted 2`, xpos, ypos, cropTop, cropBot, cropLeft, cropRight);
        await sleep(60 / BPM);
    }

    if ( ! MASTER_LOOP) {
        await resetSceneItem(scene, `gopro - inverted 2`);
    }
}

async function sideBoxes(scene) {
    while (MASTER_LOOP) {
        let cropAmount = getRandomInt(960, 1920 - 100);
        await transformScene(scene, `gopro - infrared 2`, 0, 0, 0, 0, 0, cropAmount);
        await transformScene(scene, `gopro - infrared 3`, cropAmount, 0, 0, 0, cropAmount, 0);

        await sleep(60 / BPM);
    }
}

async function centerPop(scene) {
    while (MASTER_LOOP) {
        // (1080 -600) / 2 = 240
        // (1920 -600) / 3 = 440
        //top left
        await transformScene(scene, `gopro - infra pink 2`, 300, 300, 300, 300+240, 300, (440*2)+300);
        //top center
        await transformScene(scene, `gopro - infra pink 3`, 300+(440*1), 300, 300, 300+240, (440*1)+300, (440*1)+300);
        // top right
        await transformScene(scene, `gopro - infra pink 4`, 300+(440*2), 300, 300, 300+240, (440*2)+300, (440*0)+300);
        //bottom left
        await transformScene(scene, `gopro - infra pink 5`, 300+(440*0), 300+(240*1), 300+240, 300, (440*0)+300, (440*2)+300);
        // bottom center
        await transformScene(scene, `gopro - infra pink 6`, 300+(440*1), 300+(240*1), 300+240, 300, (440*1)+300, (440*1)+300);
        //bottom right
        await transformScene(scene, `gopro - infra pink 7`, 300+(440*2), 300+(240*1), 300+240, 300, (440*2)+300, (440*0)+300);

        await sleep(60 / BPM);

        // top left
        await transformScene(scene, `gopro - infra pink 2`, 300-150, 300-150, 300, 300+240, 300, (440*2)+300);
        //top mid
        await transformScene(scene, `gopro - infra pink 3`, 300+(440*1), 300-150, 300, 300+240, (440*1)+300, (440*1)+300);
        // top right
        await transformScene(scene, `gopro - infra pink 4`, 300+(440*2)+150, 300-150, 300, 300+240, (440*2)+300, (440*0)+300);
        //bottom left
        await transformScene(scene, `gopro - infra pink 5`, 300+(440*0)-150, 300+(240*1)+150, 300+240, 300, (440*0)+300, (440*2)+300);
        // bottom mid
        await transformScene(scene, `gopro - infra pink 6`, 300+(440*1), 300+(240*1)+150, 300+240, 300, (440*1)+300, (440*1)+300);
        //bottom right
        await transformScene(scene, `gopro - infra pink 7`, 300+(440*2)+150, 300+(240*1)+150, 300+240, 300, (440*2)+300, (440*0)+300);

        await sleep(60 / BPM);
    }
}

async function centerPopTwo(scene) {
    while (MASTER_LOOP) {
        // (1080 -600) / 2 = 240
        // (1920 -600) / 3 = 440
        //top left
        await transformScene(scene, `gopro - infra pink 2`, 300, 300, 300, 300+240, 300, (440*2)+300);
        //top center
        await transformScene(scene, `gopro - infra pink 3`, 300+(440*1), 300, 300, 300+240, (440*1)+300, (440*1)+300);
        // top right
        await transformScene(scene, `gopro - infra pink 4`, 300+(440*2), 300, 300, 300+240, (440*2)+300, (440*0)+300);
        //bottom left
        await transformScene(scene, `gopro - infra pink 5`, 300+(440*0), 300+(240*1), 300+240, 300, (440*0)+300, (440*2)+300);
        // bottom center
        await transformScene(scene, `gopro - infra pink 6`, 300+(440*1), 300+(240*1), 300+240, 300, (440*1)+300, (440*1)+300);
        //bottom right
        await transformScene(scene, `gopro - infra pink 7`, 300+(440*2), 300+(240*1), 300+240, 300, (440*2)+300, (440*0)+300);

        await sleep(60 / BPM);

        // top left
        await transformScene(scene, `gopro - infra pink 2`, 300-150, 300-150, 300, 300+240, 300, (440*2)+300);
        //top mid
        await transformScene(scene, `gopro - infra pink 3`, 300+(440*1), 300-150, 300, 300+240, (440*1)+300, (440*1)+300);
        // top right
        await transformScene(scene, `gopro - infra pink 4`, 300+(440*2)+150, 300-150, 300, 300+240, (440*2)+300, (440*0)+300);
        //bottom left
        await transformScene(scene, `gopro - infra pink 5`, 300+(440*0)-150, 300+(240*1)+150, 300+240, 300, (440*0)+300, (440*2)+300);
        // bottom mid
        await transformScene(scene, `gopro - infra pink 6`, 300+(440*1), 300+(240*1)+150, 300+240, 300, (440*1)+300, (440*1)+300);
        //bottom right
        await transformScene(scene, `gopro - infra pink 7`, 300+(440*2)+150, 300+(240*1)+150, 300+240, 300, (440*2)+300, (440*0)+300);

        await sleep(60 / BPM);

        //top left
        await transformScene(scene, `gopro - infra pink 2`, 300, 300, 300, 300+240, 300, (440*2)+300);
        //top center
        await transformScene(scene, `gopro - infra pink 3`, 300+(440*1), 300, 300, 300+240, (440*1)+300, (440*1)+300);
        // top right
        await transformScene(scene, `gopro - infra pink 4`, 300+(440*2), 300, 300, 300+240, (440*2)+300, (440*0)+300);
        //bottom left
        await transformScene(scene, `gopro - infra pink 5`, 300+(440*0), 300+(240*1), 300+240, 300, (440*0)+300, (440*2)+300);
        // bottom center
        await transformScene(scene, `gopro - infra pink 6`, 300+(440*1), 300+(240*1), 300+240, 300, (440*1)+300, (440*1)+300);
        //bottom right
        await transformScene(scene, `gopro - infra pink 7`, 300+(440*2), 300+(240*1), 300+240, 300, (440*2)+300, (440*0)+300);

        await sleep(60 / BPM);

        // top left
        await transformScene(scene, `gopro - infra pink 2`, 300-300, 300-300, 300, 300+240, 300, (440*2)+300);
        //top mid
        await transformScene(scene, `gopro - infra pink 3`, 300+(440*1), 300-300, 300, 300+240, (440*1)+300, (440*1)+300);
        // top right
        await transformScene(scene, `gopro - infra pink 4`, 300+(440*2)+300, 300-300, 300, 300+240, (440*2)+300, (440*0)+300);
        //bottom left
        await transformScene(scene, `gopro - infra pink 5`, 300+(440*0)-300, 300+(240*1)+300, 300+240, 300, (440*0)+300, (440*2)+300);
        // bottom mid
        await transformScene(scene, `gopro - infra pink 6`, 300+(440*1), 300+(240*1)+300, 300+240, 300, (440*1)+300, (440*1)+300);
        //bottom right
        await transformScene(scene, `gopro - infra pink 7`, 300+(440*2)+300, 300+(240*1)+300, 300+240, 300, (440*2)+300, (440*0)+300);

        await sleep(60 / BPM);
    }
}

async function centerPopChaos(scene) {
    while (MASTER_LOOP) {
        // (1080 -600) / 2 = 240
        // (1920 -600) / 3 = 440
        // let randomOffset = getRandomInt(10, 300)
        //top left
        await transformScene(scene, `gopro - infra pink 2`, 300, 300, 300, 300+240, 300, (440*2)+300);
        //top center
        await transformScene(scene, `gopro - infra pink 3`, 300+(440*1), 300, 300, 300+240, (440*1)+300, (440*1)+300);
        // top right
        await transformScene(scene, `gopro - infra pink 4`, 300+(440*2), 300, 300, 300+240, (440*2)+300, (440*0)+300);
        //bottom left
        await transformScene(scene, `gopro - infra pink 5`, 300+(440*0), 300+(240*1), 300+240, 300, (440*0)+300, (440*2)+300);
        // bottom center
        await transformScene(scene, `gopro - infra pink 6`, 300+(440*1), 300+(240*1), 300+240, 300, (440*1)+300, (440*1)+300);
        //bottom right
        await transformScene(scene, `gopro - infra pink 7`, 300+(440*2), 300+(240*1), 300+240, 300, (440*2)+300, (440*0)+300);

        await sleep(60 / BPM);

        // top left
        await transformScene(scene, `gopro - infra pink 2`, 300-getRandomInt(10, 300), 300-getRandomInt(10, 300), 300, 300+240, 300, (440*2)+300);
        //top mid
        await transformScene(scene, `gopro - infra pink 3`, 300+(440*1), 300-getRandomInt(10, 300), 300, 300+240, (440*1)+300, (440*1)+300);
        // top right
        await transformScene(scene, `gopro - infra pink 4`, 300+(440*2)+getRandomInt(10, 300), 300-getRandomInt(10, 300), 300, 300+240, (440*2)+300, (440*0)+300);
        //bottom left
        await transformScene(scene, `gopro - infra pink 5`, 300+(440*0)-getRandomInt(10, 300), 300+(240*1)+getRandomInt(10, 300), 300+240, 300, (440*0)+300, (440*2)+300);
        // bottom mid
        await transformScene(scene, `gopro - infra pink 6`, 300+(440*1), 300+(240*1)+getRandomInt(10, 300), 300+240, 300, (440*1)+300, (440*1)+300);
        //bottom right
        await transformScene(scene, `gopro - infra pink 7`, 300+(440*2)+getRandomInt(10, 300), 300+(240*1)+getRandomInt(10, 300), 300+240, 300, (440*2)+300, (440*0)+300);

        await sleep(60 / BPM);
    }
}


async function scrollingSides(scene) {
    while (MASTER_LOOP) {
        for (let i = 1080; i > 0; i--) {
            await transformScene(scene, `gopro - purple acid 2`, 0, i, 0, 0, 0, 1520);
            await transformScene(scene, `gopro - purple acid 3`, 1520, - i, 0, 0, 1520, 0);
            await sleep(0.002);
        }
        for (let i = 0; i > - 1080; i--) {
            await transformScene(scene, `gopro - purple acid 2`, 0, i, 0, 0, 0, 1520);
            await transformScene(scene, `gopro - purple acid 3`, 1520, - i, 0, 0, 1520, 0);
            await sleep(0.002);
        }
        for (let i = - 1080; i < 0; i++) {
            await transformScene(scene, `gopro - purple acid 2`, 0, i, 0, 0, 0, 1520);
            await transformScene(scene, `gopro - purple acid 3`, 1520, - i, 0, 0, 1520, 0);
            await sleep(0.002);
        }
        for (let i = 0; i < 1080; i++) {
            await transformScene(scene, `gopro - purple acid 2`, 0, i, 0, 0, 0, 1520);
            await transformScene(scene, `gopro - purple acid 3`, 1520, - i, 0, 0, 1520, 0);
            await sleep(0.002);
        }
    }
}

async function lutVertStripe(scene) {
    const size = 240;
    while (MASTER_LOOP) {
        for (let i = 0; i < 8; i++ ) {
            await OBS_CONTROLLER.send(`SetSceneItemProperties`, {
                'scene-name': scene.name,
                item: {
                    name: `gopro - inverted`
                },
                crop: {
                    top: 0,
                    bottom: 0,
                    left: i * size,
                    right: 1920 - ((i + 1) * size)
                },
                position: {
                    x: i * size,
                    y: 0
                }
            });
            await sleep(60 / BPM);
        }
        for (let i = 6; i > 0; i-- ) {
            await OBS_CONTROLLER.send(`SetSceneItemProperties`, {
                'scene-name': scene.name,
                item: {
                    name: `gopro - inverted`
                },
                crop: {
                    top: 0,
                    bottom: 0,
                    left: i * size,
                    right: 1920 - ((i + 1) * size)
                },
                position: {
                    x: i * size,
                    y: 0
                }
            });
            await sleep(60 / BPM);
        }

        if ( ! MASTER_LOOP) {
            await resetSceneItem(scene, `gopro - inverted`);
        }
    }
}

async function doubleLutHorizStripe(scene) {
    const size = 135;
    let counter = 0;
    while (MASTER_LOOP) {
        counter = 8;
        for (let i = 0; i < 4; i++ ) {
            // console.log(`top loop i = ${i}`);
            await OBS_CONTROLLER.send(`SetSceneItemProperties`, {
                'scene-name': scene.name,
                item: {
                    name: `gopro - magenta orange`
                },
                crop: {
                    top: i * size,
                    bottom: 1080 - ((i + 1) * size),
                    left: 0,
                    right: 0
                },
                position: {
                    x: 0,
                    y: i * size
                }
            });

            await OBS_CONTROLLER.send(`SetSceneItemProperties`, {
                'scene-name': scene.name,
                item: {
                    name: `gopro - magenta orange 2`
                },
                crop: {
                    top:  (counter - 1) * size,
                    bottom: i * size,
                    left: 0,
                    right: 0
                },
                position: {
                    x: 0,
                    y: (counter - 1) * size
                }
            });
            counter--;
            await sleep(60 / BPM);
        }

        counter = 5;
        for (let i = 2; i > 0; i-- ) {
            // console.log(`bottom loop i = ${i}`);
            await OBS_CONTROLLER.send(`SetSceneItemProperties`, {
                'scene-name': scene.name,
                item: {
                    name: `gopro - magenta orange`
                },
                crop: {
                    top: i * size,
                    bottom: 1080 - ((i + 1) * size),
                    left: 0,
                    right: 0
                },
                position: {
                    x: 0,
                    y: i * size
                }
            });

            await OBS_CONTROLLER.send(`SetSceneItemProperties`, {
                'scene-name': scene.name,
                item: {
                    name: `gopro - magenta orange 2`
                },
                crop: {
                    top:  (counter) * size,
                    bottom: i * size,
                    left: 0,
                    right: 0
                },
                position: {
                    x: 0,
                    y: (counter) * size
                }
            });
            counter++;
            await sleep(60 / BPM);
        }
        if ( ! MASTER_LOOP) {
            await resetSceneItem(scene, `gopro - magenta orange`);
            await resetSceneItem(scene, `gopro - magenta orange 2`);
        }
    }
}

async function doubleLutVertStripe(scene) {
    const size = 240;
    let counter = 0;
    while (MASTER_LOOP) {
        counter = 8;
        for (let i = 0; i < 4; i++ ) {
            // console.log(`top loop i = ${i}`);
            await OBS_CONTROLLER.send(`SetSceneItemProperties`, {
                'scene-name': scene.name,
                item: {
                    name: `gopro - infrared`
                },
                crop: {
                    top: 0,
                    bottom: 0,
                    left: i * size,
                    right: 1920 - ((i + 1) * size)
                },
                position: {
                    x: i * size,
                    y: 0
                }
            });

            await OBS_CONTROLLER.send(`SetSceneItemProperties`, {
                'scene-name': scene.name,
                item: {
                    name: `gopro - infrared 2`
                },
                crop: {
                    top:  0,
                    bottom: 0,
                    left: (counter - 1) * size,
                    right: i * size
                },
                position: {
                    x: (counter - 1) * size,
                    y: 0
                }
            });
            counter--;
            await sleep(60 / BPM);
        }

        counter = 5;
        for (let i = 2; i > 0; i-- ) {
            // console.log(`bottom loop i = ${i}`);
            await OBS_CONTROLLER.send(`SetSceneItemProperties`, {
                'scene-name': scene.name,
                item: {
                    name: `gopro - infrared`
                },
                crop: {
                    top: 0,
                    bottom: 0,
                    left: i * size,
                    right: 1920 - ((i + 1) * size)
                },
                position: {
                    x: i * size,
                    y: 0
                }
            });

            await OBS_CONTROLLER.send(`SetSceneItemProperties`, {
                'scene-name': scene.name,
                item: {
                    name: `gopro - infrared 2`
                },
                crop: {
                    top:  0,
                    bottom: 0,
                    left: (counter) * size,
                    right: i * size
                },
                position: {
                    x: (counter) * size,
                    y: 0
                }
            });
            counter++;
            await sleep(60 / BPM);
        }
        if ( ! MASTER_LOOP) {
            await resetSceneItem(scene, `gopro - infrared`);
            await resetSceneItem(scene, `gopro - infrared 2`);
        }
    }
}

async function strobe(scene) {
    // const itemNames = getRelevantSceneItems(scene.sources, `strobe`)
    let toggleState = true;
    for (let i = 0; i < 400; i++) {
        await OBS_CONTROLLER.send(`SetSceneItemProperties`, {
            'scene-name': scene.name,
            item: {
                name: `1080p strobe`
            },
            visible: toggleState
        });
        toggleState = !toggleState;
        await sleep(0.01);
    }
}

async function interlaced(scene) {
    for (let i = 0; i < 12; i++) {
        await transformScene(scene, `gopro - orange acid ${i + 1}`, 0, 90 * i, 90 * i, 1080 - (90 * (i + 1)), 0, 0);
    }

    while (MASTER_LOOP) {

        // stripe number definitions and vertical placement
        // stripe goes away r to l
        for (let i = 0; i < 12; i++) {
            // right cropping of each stripe
            for (let j = 0; j < 1920; j++) {
                await transformScene(scene, `gopro - orange acid ${i + 1}`, 0, 90 * i, 90 * i, 1080 - (90 * (i + 1)), 0, j);
            }
        }
        // stripe goes back l to r
        for (let i = 11; i >= 0; i--) {
            // right cropping of each stripe
            for (let j = 1920; j > 0; j--) {
                await transformScene(scene, `gopro - orange acid ${i + 1}`, 0, 90 * i, 90 * i, 1080 - (90 * (i + 1)), 0, j);
            }
        }

        await sleep(10);
    }
}

async function executeLoopingScene(scene) {
    console.log(`scene = ${scene.sceneName}`);
    MASTER_LOOP = true
    switch (scene.sceneName) {
        case `HORIZ LUT STRIPE -- GOPRO`: {
            await lutHorizStripe(scene);
            break;
        }
        case `VERT LUT STRIPE -- GOPRO`: {
            await lutVertStripe(scene);
            break;
        }
        case `DUB HORIZ LUT STRIPE -- GOPRO`: {
            await doubleLutHorizStripe(scene);
            break;
        }
        case `DUB VERT LUT STRIPE -- GOPRO`: {
            await doubleLutVertStripe(scene);
            break;
        }
        case `LUT RESIZE SPIRAL -- GOPRO`: {
            await transformSpin(scene);
            break;
        }
        case `LUTS -- GOPRO`: {
            await lutCycle(scene);
            break;
        }
        case `STROBE -- GOPRO`: {
            await strobe(scene);
            break;
        }
        case `WINTERGREEN ZIPPER -- GOPRO`: {
            await zipperFlow(scene);
            break;
        }
        case `WINTERGREEN ZIPPER 2 -- GOPRO`: {
            await zipperFlow2(scene);
            break;
        }
        case `WINTERGREEN ZIPPER CHAOS -- GOPRO`: {
            await zipperFlowChaos(scene);
            break;
        }
        case `RANDOM BOX -- GOPRO`: {
            await randomBox(scene);
            break;
        }
        case `SIDE BOXES -- GOPRO`: {
            await sideBoxes(scene);
            break;
        }
        case `SCROLLING SIDES -- GOPRO`: {
            await scrollingSides(scene);
            break;
        }

        case `CENTER POP -- GOPRO`: {
            await centerPop(scene);
            break;
        }

        case `CENTER POP 2 -- GOPRO`: {
            await centerPopTwo(scene);
            break;
        }
        case `CENTER POP CHAOS -- GOPRO`: {
            await centerPopChaos(scene);
            break;
        }

        case `INTERLACED -- GOPRO`: {
            await interlaced(scene);
            break;
        }
        default: {
            break;
        }
    }
}

async function transformScene(scene, itemName, posX, posY, crT, crB, crL, crR) {
    await OBS_CONTROLLER.send(`SetSceneItemProperties`, {
        'scene-name': scene.name,
        item: {
            name: itemName
        },
        position: {
            x: posX,
            y: posY
        },
        crop: {
            top: crT,
            bottom: crB,
            left: crL,
            right: crR
        }
    });
}

(async () => {
    setupMIDI(midiControllerName);
    VLC_CONTROLLER = await initializeVLC(VLC_PLAYLISTS[0], vlcOptions);
    await randomVlcSkipTracks();
    await establishObsConnection();
    registerObsListeners();


    input.on('noteon', (args) => {
        console.log('noteon', args);
        let midiString = `c` + (args.channel + 1) + `n` + args.note;
        if (keyMap[midiString]) {
            executeMidiKeyTrigger(keyMap[midiString]);
        } else {
            console.log(`No midi trigger set for channel ${args.channel} and note ${args.note}`);
        }
    });

    input.on('cc', args => {
        console.log('cc', args);
        let midiString = `c` + (args.channel + 1) + `c` + args.controller;
        if (keyMap[midiString]) {
            executeMidiRotaryController(keyMap[midiString], midiString, args.value);
        } else {
            console.log(`No midi trigger set for channel ${args.channel} and controller ${args.controller}`);
        }
    });
})();
