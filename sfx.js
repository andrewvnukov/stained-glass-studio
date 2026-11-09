'use strict';
// ============================================================
// sfx.js — процедурные звуки и генеративный музыкальный луп. Никаких
// аудиофайлов — весь звук синтезируется на лету движком ZzFXMicro
// (Frank Force, MIT/CC0, https://killedbyapixel.github.io/ZzFX/).
// ============================================================
const audioDefaultSampleRate = 44100;
let audioCtx = null, masterGain = null;
function ensureAudio(){
  if(audioCtx) return audioCtx;
  try{
    audioCtx = new (window.AudioContext||window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = .6;
    masterGain.connect(audioCtx.destination);
  }catch(e){}
  return audioCtx;
}
addEventListener("pointerdown", ()=>{ const ctx=ensureAudio(); if(ctx&&ctx.state!=="running") ctx.resume().catch(()=>{}); }, {once:true, passive:true});

// ---------- Приглушение звука: вручную (реклама) и по видимости вкладки ----------
function audioSuspend(){ try{ if(audioCtx && audioCtx.state==="running") audioCtx.suspend(); }catch(e){} }
function audioResume(){ try{ if(audioCtx && audioCtx.state==="suspended" && document.visibilityState==="visible") audioCtx.resume(); }catch(e){} }
// звук паузится при потере фокуса вкладки (не путать с ручным глушением на время рекламы —
// во время показа рекламы страница фокус НЕ теряет, поэтому этот слушатель её не тронет)
document.addEventListener("visibilitychange", ()=>{ if(document.hidden) audioSuspend(); else audioResume(); });

const rand = (a=1,b=0) => b+(a-b)*Math.random();

// ---------- ZzFXMicro: генерация сэмплов по параметрам ----------
function zzfxG(volume=1, randomness=.05, frequency=220, attack=0, sustain=0, release=.1,
  shape=0, shapeCurve=1, slide=0, deltaSlide=0, pitchJump=0, pitchJumpTime=0, repeatTime=0,
  noise=0, modulation=0, bitCrush=0, delay=0, sustainVolume=1, decay=0, tremolo=0, filter=0){
  let sampleRate=audioDefaultSampleRate, PI2=Math.PI*2,
    startSlide=slide*=500*PI2/sampleRate/sampleRate,
    startFrequency=frequency*=(1+rand(randomness,-randomness))*PI2/sampleRate,
    modOffset=0, repeat=0, crush=0, jump=1, length, b=[], t=0, i=0, s=0, f,
    quality=2, w=PI2*Math.abs(filter)*2/sampleRate,
    cosw=Math.cos(w), alpha=Math.sin(w)/2/quality,
    a0=1+alpha, a1=-2*cosw/a0, a2=(1-alpha)/a0,
    b0=(1+Math.sign(filter)*cosw)/2/a0, b1=-(Math.sign(filter)+cosw)/a0, b2=b0,
    x2=0, x1=0, y2=0, y1=0;
  const minAttack=9;
  attack=attack*sampleRate||minAttack; decay*=sampleRate; sustain*=sampleRate; release*=sampleRate;
  delay*=sampleRate; deltaSlide*=500*PI2/sampleRate**3; modulation*=PI2/sampleRate;
  pitchJump*=PI2/sampleRate; pitchJumpTime*=sampleRate; repeatTime=repeatTime*sampleRate|0;
  for(length=attack+decay+sustain+release+delay|0; i<length; b[i++]=s*volume){
    if(!(++crush%(bitCrush*100|0))){
      s = shape? shape>1? shape>2? shape>3? shape>4?
          (t/PI2%1 < shapeCurve/2? 1:-1):
          Math.sin(t**3):
          Math.max(Math.min(Math.tan(t),1),-1):
          1-(2*t/PI2%2+2)%2:
          1-4*Math.abs(Math.round(t/PI2)-t/PI2):
          Math.sin(t);
      s = (repeatTime? 1-tremolo+tremolo*Math.sin(PI2*i/repeatTime) : 1) *
          (shape>4?s:Math.sign(s)*Math.abs(s)**shapeCurve) *
          (i<attack? i/attack :
           i<attack+decay? 1-((i-attack)/decay)*(1-sustainVolume) :
           i<attack+decay+sustain? sustainVolume :
           i<length-delay? (length-i-delay)/release*sustainVolume : 0);
      s = delay? s/2 + (delay>i? 0 : (i<length-delay? 1:(length-i)/delay) * b[i-delay|0]/2/volume) : s;
      if(filter) s = y1 = b2*x2 + b1*(x2=x1) + b0*(x1=s) - a2*y2 - a1*(y2=y1);
    }
    f=(frequency+=slide+=deltaSlide)*Math.cos(modulation*modOffset++);
    t+=f+f*noise*Math.sin(i**5);
    if(jump && ++jump>pitchJumpTime){ frequency+=pitchJump; startFrequency+=pitchJump; jump=0; }
    if(repeatTime && !(++repeat%repeatTime)){ frequency=startFrequency; slide=startSlide; jump=jump||1; }
  }
  return b;
}
function playBuffer(samples, volume=1, loop=false){
  const ctx=ensureAudio(); if(!ctx) return;
  const buf=ctx.createBuffer(1, samples.length, audioDefaultSampleRate);
  buf.getChannelData(0).set(samples);
  const src=ctx.createBufferSource(); src.buffer=buf; src.loop=loop;
  const g=ctx.createGain(); g.gain.value=volume;
  src.connect(g).connect(masterGain);
  src.start(0);
  return src;
}
function zzfx(...params){ return playBuffer(zzfxG(...params)); }


// ---------- тема «вечерняя витражная мастерская»: стекло, свинец, тёплая лампа ----------
const SFX = {
  tap:   [.4,.04,760,.002,.01,.04,0,2.6,0,0,0,0,0,.2,0,0,0,.45,.01],              // лёгкий «цок» стекла при взятии осколка
  place: [.5,.04,520,.001,.015,.07,0,2.2,0,0,-180,.02,0,.3,0,0,0,.55,.02],         // осколок лёг в раму — стеклянный стук
  solder:[.5,.03,1244,.01,.1,.3,0,1.5,0,0,392,.05,.08,0,0,0,.1,.75,.03],           // ряд спаян — светлый «звон» по стеклу
  panel: [.6,0,1046,.01,.22,.5,0,1.4,0,0,523,.09,.14,0,0,0,.12,.85,.05],           // витраж готов — колокольный аккорд
  coin:  [.5,0,1318,.01,.035,.12,0,1.7,0,0,440,.04,.06,0,0,0,0,.7,.02],            // «дзынь» осколков в копилку
  buy:   [.5,0,600,.01,.07,.18,0,1.5,0,0,220,.05,.07,0,0,0,0,.8,.04],              // покупка инструмента
  sweep: [.4,.08,320,.01,.08,.22,1,1.1,-3,0,0,0,.05,.7,0,.04,0,.6,.05],            // щётка смела осколки со стола
  error: [.42,0,160,.02,.05,.13,1,.8,0,0,0,0,0,.16,0,.08,0,.7,.04],                // мягкий глухой отказ
};
function sfx(name){ if(typeof catchUp!=="undefined" && catchUp) return; try{ zzfx(...SFX[name]); }catch(e){} }

// ---------- Генеративный музыкальный луп ----------
// F-мажор, 84 BPM, прогрессия F–Dm–Bb–C (I–vi–IV–V), два круга по 4 такта = 32 доли.
// Три слоя: пэды-аккорды (синус, мягкая атака — тёплый свет лампы), бас на корне
// октавой ниже (треугольник), мелодия-«стеклянные колокольчики» по пентатонике F
// с коротким эхом (delay) — звенящее стекло. Хвосты нот, вылетающие за конец лупа,
// заворачиваются в его начало — луп по-настоящему бесшовный.
// Буфер нормализован к пику 0.8 (иначе клиппинг на сумме слоёв).
const NOTE_HZ = m => 440*Math.pow(2,(m-69)/12);
function mixInto(mix, samples, offset, gain){
  gain = gain==null?1:gain;
  const L=mix.length;
  for(let i=0;i<samples.length;i++){
    let idx=offset+i; if(idx<0) continue; idx%=L;
    mix[idx]+=(samples[i]||0)*gain;
  }
}
function buildSong(){
  const sr=audioDefaultSampleRate, bpm=84, beat=60/bpm;
  const chords=[ [65,69,72], [62,65,69], [58,62,65], [60,64,67] ];  // F, Dm, Bb, C
  const bassRoots=[41,38,34,36];                                     // F2, D2, Bb1, C2
  const melodyScale=[77,79,81,84,86,89];                             // F5 G5 A5 C6 D6 F6 (пентатоника F)
  const melodyPattern=[
    [0,-1,2,3],[4,2,-1,1],[3,-1,1,0],[2,4,-1,3],
    [5,-1,4,2],[3,1,-1,2],[0,2,4,-1],[1,-1,-1,0],
  ];
  const barsPerLoop=4, loops=2, totalBeats=barsPerLoop*4*loops;
  const mix = new Float32Array(Math.round(totalBeats*beat*sr));
  for(let loop=0; loop<loops; loop++){
    for(let bar=0; bar<barsPerLoop; bar++){
      const ci=bar%4, chord=chords[ci], bassRoot=bassRoots[ci];
      const barStartBeat = loop*barsPerLoop*4 + bar*4;
      const barStartSample = Math.round(barStartBeat*beat*sr);
      // пэд: три ноты аккорда, мягкая атака, длинный релиз
      chord.forEach(note=>{
        const s=zzfxG(.16,0,NOTE_HZ(note),.85,2.75*beat,1.3,0,1,0,0,0,0,0,0,0,0,0,.9,0,0,0);
        mixInto(mix, s, barStartSample, 1);
      });
      // бас на 1-й и 3-й доле
      [0,2].forEach(b=>{
        const bs=zzfxG(b?.17:.26,0,NOTE_HZ(bassRoot),.02,beat*0.85,.3,1,1,0,0,0,0,0,0,0,0,0,.85,0,0,0);
        mixInto(mix, bs, Math.round((barStartBeat+b)*beat*sr), 1);
      });
      // мелодия-колокольчик с эхом
      const pattern = melodyPattern[(loop*barsPerLoop+bar)%melodyPattern.length];
      pattern.forEach((deg,i)=>{
        if(deg<0) return;
        const noteSample = Math.round((barStartBeat+i)*beat*sr);
        const m=zzfxG(.15,0,NOTE_HZ(melodyScale[deg]),.012,beat*0.28,.34,0,1.6,0,0,0,0,0,0,0,0,.14,.85,0,0,0);
        mixInto(mix, m, noteSample, 1);
      });
    }
  }
  let peak=0; for(let i=0;i<mix.length;i++){ const a=Math.abs(mix[i]); if(a>peak) peak=a; }
  if(peak>0){ const k=0.8/peak; for(let i=0;i<mix.length;i++) mix[i]*=k; }
  return mix;
}
let musicSrc=null;
function startMusic(){
  if(musicSrc) return;
  const ctx=ensureAudio(); if(!ctx) return;
  try{ musicSrc=playBuffer(buildSong(), .38, true); }catch(e){}   // тише sfx: музыка не заглушает эффекты
}
function stopMusic(){ if(musicSrc){ try{ musicSrc.stop(); }catch(e){} musicSrc=null; } }
