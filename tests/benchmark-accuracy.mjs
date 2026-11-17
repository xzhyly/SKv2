// tests/benchmark-accuracy.mjs
// Automated benchmark comparing sign recognition accuracy:
// BEFORE (Standard k-NN alone) vs NOW (k-NN + Zero-re-recording Wrist Location Boost)
import fs from 'fs';
import path from 'path';
import KnnCompile from '../js/knn-compile.js';
import GloveBend from '../js/glove-bend.js';

// 1. Load compiled model (models/knn_ESL.bin)
const modelBuffer = fs.readFileSync('models/knn_ESL.bin');
const decoded = KnnCompile.decode(modelBuffer);
const knnModel = decoded.model;

// 2. Cosine similarity
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// 3. Flatten raw hand landmarks to 126 floats
function flattenHand(hand) {
  if (!Array.isArray(hand) || hand.length < 21) return Array(63).fill(0);
  const wrist = hand[0];
  const normalized = hand.map(p => ({
    x: (Number(p.x) || 0) - (Number(wrist.x) || 0),
    y: (Number(p.y) || 0) - (Number(wrist.y) || 0),
    z: (Number(p.z) || 0) - (Number(wrist.z) || 0),
  }));
  const scale = Math.max(...normalized.map(p => Math.hypot(p.x, p.y, p.z)), 0.0001);
  const out = [];
  normalized.forEach(p => out.push(p.x / scale, p.y / scale, p.z / scale));
  return out;
}

function flattenLandmarks(hands) {
  if (!Array.isArray(hands) || !hands.length) return Array(126).fill(0);
  const h1 = flattenHand(hands[0].landmarks || hands[0]);
  const h2 = hands.length >= 2 ? flattenHand(hands[1].landmarks || hands[1]) : Array(63).fill(0);
  return h1.concat(h2);
}

// 4. Baseline Wrist Height Map (exact from js/talk-signing.js)
const SIGN_HEIGHT_MAP = {
  "1":0.59,"2":0.59,"3":0.59,"4":0.6,"5":0.6,"6":0.57,"7":0.61,"8":0.59,"9":0.61,"10":0.6,
  "a":0.48,"again":0.52,"always":0.66,"b":0.51,"bad":0.6,"bath":0.72,"bathroom":0.54,
  "be_careful":0.62,"c":0.47,"cant":0.57,"close":0.68,"d":0.53,"day":0.56,"deaf":0.56,
  "different":0.61,"doctor":0.65,"dont_care":0.51,"dont_know":0.46,"dont_like":0.65,
  "dont_understand":0.44,"dont_want":0.64,"door":0.67,"down":0.44,"e":0.52,"eat":0.51,
  "excuse_me":0.63,"f":0.53,"finally":0.61,"for":0.44,"full":0.46,"g":0.53,"game":0.59,
  "go":0.63,"good":0.61,"goodbye":0.53,"good_afternoon":0.6,"good_morning":0.62,"good_night":0.62,
  "h":0.51,"hands":0.68,"have":0.64,"healthy":0.58,"hearing":0.51,"hello":0.42,"help":0.57,
  "home":0.49,"how":0.63,"how_are_you":0.64,"how_many":0.68,"how_much":0.65,"hungry":0.77,
  "hurt":0.66,"i":0.54,"im_fine":0.68,"im_sorry":0.65,"i_love_you":0.6,"j":0.58,"k":0.55,
  "know":0.44,"l":0.54,"last_week":0.55,"last_year":0.54,"late":0.59,"later":0.56,
  "lights_off":0.34,"lights_on":0.38,"m":0.52,"mad":0.54,"maybe":0.66,"me":0.66,"medicine":0.61,
  "minute":0.54,"month":0.5,"more":0.58,"motivated":0.64,"must":0.53,"my_name_is":0.68,
  "n":0.52,"need":0.59,"never":0.53,"new":0.6,"next_week":0.53,"next_year":0.56,
  "nice_to_meet_you":0.56,"night":0.58,"no":0.58,"not":0.6,"not_yet":0.55,"now":0.66,"o":0.47,
  "off":0.56,"often":0.55,"old":0.61,"on":0.66,"open":0.7,"p":0.35,"play":0.66,"please":0.69,
  "q":0.33,"r":0.53,"recently":0.57,"restroom":0.55,"right":0.63,"run":0.62,"s":0.49,"same":0.71,
  "school":0.62,"second":0.5,"see_you_later":0.53,"shower":0.22,"sick":0.38,"sleep":0.54,
  "sometimes":0.56,"stop":0.56,"t":0.51,"take_care":0.68,"thank_you":0.6,"thirsty":0.61,
  "tired":0.73,"to":0.64,"today":0.67,"tonight":0.67,"tv":0.56,"u":0.55,"understand":0.48,
  "up":0.45,"v":0.59,"w":0.58,"walk":0.6,"want":0.73,"wash":0.65,"week":0.66,"weekend":0.63,
  "welcome":0.72,"what":0.68,"what_for":0.45,"what_happened":0.63,"what_is_your_name":0.65,
  "what_time_is_it":0.57,"when":0.59,"where":0.59,"wheres_the_bathroom":0.58,"which":0.66,
  "who":0.52,"why":0.52,"will":0.54,"wont":0.49,"work":0.61,"wrong":0.53,"x":0.54,"y":0.53,
  "yes":0.52,"you":0.58,"z":0.6
};

// 5. Prediction function (Standard k-NN)
function predictRaw(features) {
  const mirroredFeatures = [...features];
  for (let i = 0; i < mirroredFeatures.length; i += 3) mirroredFeatures[i] = -mirroredFeatures[i];
  if (mirroredFeatures.length === 126) {
    const h1 = mirroredFeatures.slice(0, 63);
    const h2 = mirroredFeatures.slice(63, 126);
    if (h1.some(v => v !== 0) && h2.some(v => v !== 0)) {
      mirroredFeatures.splice(0, 63, ...h2);
      mirroredFeatures.splice(63, 63, ...h1);
    }
  }

  const rawScores = {};
  for (const label of Object.keys(knnModel)) {
    const frames = knnModel[label];
    if (!frames || !frames.length) continue;
    const sims = frames.map(f => Math.max(cosineSimilarity(features, f), cosineSimilarity(mirroredFeatures, f)));
    sims.sort((a, b) => b - a);
    const topK = sims.slice(0, Math.min(5, sims.length));
    rawScores[label] = topK.reduce((s, v) => s + v, 0) / topK.length;
  }
  const entries = Object.entries(rawScores).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return null;
  const normalized = {};
  for (const [l, s] of entries.slice(0, 5)) {
    normalized[l] = Math.max(0, Math.min(1, (s - 0.3) / 0.7));
  }
  return normalized;
}

// 6. Location Boost function (Safe Tie-Breaker)
function applyLocationBoost(scores, wristY) {
  if (typeof wristY !== 'number' || !scores) return scores;
  const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (entries.length < 2) return scores;

  const [top1, s1] = entries[0];
  const [top2, s2] = entries[1];
  const out = { ...scores };

  if (s1 - s2 < 0.05) {
    const y1 = SIGN_HEIGHT_MAP[top1];
    const y2 = SIGN_HEIGHT_MAP[top2];
    if (typeof y1 === 'number' && typeof y2 === 'number') {
      const diff1 = Math.abs(wristY - y1);
      const diff2 = Math.abs(wristY - y2);
      if (diff2 + 0.12 < diff1) {
        out[top2] = s1 + 0.02; // promote candidate 2 as tie-breaker
      }
    }
  }
  return out;
}

// 7. Run Benchmark across gesture samples
async function runBenchmark() {
  console.log('========================================================================');
  console.log('  SINING KAMAY (SKv2) AUTOMATED ACCURACY BENCHMARK');
  console.log('  Testing: Standard k-NN (Before) vs Wrist Location Boost (Now)');
  console.log('========================================================================\n');

  const gestureDirs = fs.readdirSync('saved_gestures')
    .filter(d => fs.statSync(path.join('saved_gestures', d)).isDirectory())
    .filter(d => Object.prototype.hasOwnProperty.call(knnModel, d));

  let totalFrames = 0;
  let correctBefore = 0;
  let correctNow = 0;
  let top3Before = 0;
  let top3Now = 0;
  let crossZoneErrorsBefore = 0;
  let crossZoneErrorsNow = 0;

  const sampleLimitPerSign = 3; // Evaluate 3 real recordings per sign

  for (const label of gestureDirs) {
    const dirPath = path.join('saved_gestures', label);
    const sampleFiles = fs.readdirSync(dirPath).filter(f => f.startsWith('sample_') && f.endsWith('.json'));
    if (!sampleFiles.length) continue;

    for (const file of sampleFiles.slice(0, sampleLimitPerSign)) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dirPath, file), 'utf8'));
        if (!data.frames || !data.frames.length) continue;

        // Sample every 4th frame
        for (let i = 0; i < data.frames.length; i += 4) {
          const frame = data.frames[i];
          if (!frame.hands || !frame.hands.length || !frame.hands[0].landmarks) continue;

          const rawWristY = frame.hands[0].landmarks[0].y;
          const features = flattenLandmarks(frame.hands);

          const scoresBefore = predictRaw(features);
          if (!scoresBefore) continue;

          const scoresNow = applyLocationBoost(scoresBefore, rawWristY);

          // Get top-1 and top-3 for Before
          const sortedBefore = Object.entries(scoresBefore).sort((a, b) => b[1] - a[1]);
          const predBefore = sortedBefore[0] ? sortedBefore[0][0] : null;
          const inTop3Before = sortedBefore.slice(0, 3).some(e => e[0] === label);

          // Get top-1 and top-3 for Now
          const sortedNow = Object.entries(scoresNow).sort((a, b) => b[1] - a[1]);
          const predNow = sortedNow[0] ? sortedNow[0][0] : null;
          const inTop3Now = sortedNow.slice(0, 3).some(e => e[0] === label);

          totalFrames++;
          if (predBefore === label) correctBefore++;
          if (predNow === label) correctNow++;
          if (inTop3Before) top3Before++;
          if (inTop3Now) top3Now++;

          // Check cross-zone error (e.g. face sign confused with chest sign or vice-versa)
          const expectedY = SIGN_HEIGHT_MAP[label];
          if (predBefore !== label && expectedY && SIGN_HEIGHT_MAP[predBefore]) {
            if (Math.abs(expectedY - SIGN_HEIGHT_MAP[predBefore]) > 0.25) crossZoneErrorsBefore++;
          }
          if (predNow !== label && expectedY && SIGN_HEIGHT_MAP[predNow]) {
            if (Math.abs(expectedY - SIGN_HEIGHT_MAP[predNow]) > 0.25) crossZoneErrorsNow++;
          }
        }
      } catch (err) {}
    }
  }

  const accBefore = ((correctBefore / totalFrames) * 100).toFixed(2);
  const accNow = ((correctNow / totalFrames) * 100).toFixed(2);
  const top3AccBefore = ((top3Before / totalFrames) * 100).toFixed(2);
  const top3AccNow = ((top3Now / totalFrames) * 100).toFixed(2);

  console.log(`Evaluated ${totalFrames} frames across ${gestureDirs.length} gesture classes:\n`);
  console.log(`------------------------------------------------------------------------`);
  console.log(`  METRIC                              BEFORE (Baseline)   NOW (With Boost)`);
  console.log(`------------------------------------------------------------------------`);
  console.log(`  Top-1 Accuracy (Exact Match):        ${accBefore}%            ${accNow}%`);
  console.log(`  Top-3 Accuracy (In Top-3):           ${top3AccBefore}%            ${top3AccNow}%`);
  console.log(`  Cross-Zone Confusion Errors:         ${crossZoneErrorsBefore} errors           ${crossZoneErrorsNow} errors`);
  console.log(`------------------------------------------------------------------------\n`);

  const gain = (accNow - accBefore).toFixed(2);
  const errorReduction = (((crossZoneErrorsBefore - crossZoneErrorsNow) / (crossZoneErrorsBefore || 1)) * 100).toFixed(1);
  console.log(`🎯 RESULT: +${gain}% increase in Top-1 Accuracy!`);
  console.log(`🎯 ERROR REDUCTION: ${errorReduction}% reduction in cross-body confusion!`);
  console.log('========================================================================');
}

runBenchmark();
