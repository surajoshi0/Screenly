/* Screenly – simple screen recorder and screenshot tool (client-only) */
(function(){
  /** @type {MediaStream|null} */
  let displayStream = null;
  /** @type {MediaRecorder|null} */
  let mediaRecorder = null;
  /** @type {Blob[]} */
  let recordedChunks = [];
  /** @type {HTMLVideoElement} */
  const previewEl = document.getElementById('preview');
  const statusEl = document.getElementById('status');

  const btnStart = document.getElementById('btnStart');
  const btnPause = document.getElementById('btnPause');
  const btnResume = document.getElementById('btnResume');
  const btnStop = document.getElementById('btnStop');
  const btnScreenshot = document.getElementById('btnScreenshot');
  const btnDownloadLast = document.getElementById('btnDownloadLast');
  const btnClearGallery = document.getElementById('btnClearGallery');
  const galleryGrid = document.getElementById('galleryGrid');
  const optMic = document.getElementById('optMic');
  const optFps = document.getElementById('optFps');
  const optCountdown = document.getElementById('optCountdown');
  const liveTimer = document.getElementById('liveTimer');

  let lastVideoBlobUrl = null;

  function setStatus(text){
    statusEl.textContent = text || '';
  }

  function enableWhileRecording(){
    btnStart.disabled = true;
    btnPause.disabled = false;
    btnResume.disabled = true;
    btnStop.disabled = false;
    btnScreenshot.disabled = false;
  }

  function enableIdle(){
    btnStart.disabled = false;
    btnPause.disabled = true;
    btnResume.disabled = true;
    btnStop.disabled = true;
    btnScreenshot.disabled = true;
  }

  function ensureGalleryState(){
    const hasItems = galleryGrid.children.length > 0;
    btnDownloadLast.disabled = !lastVideoBlobUrl;
    btnClearGallery.disabled = !hasItems;
    if(!hasItems){
      galleryGrid.innerHTML = '<div class="empty">No items yet. Record or capture to see them here.</div>';
    } else if(galleryGrid.querySelector('.empty')){
      const empty = galleryGrid.querySelector('.empty');
      if(empty) empty.remove();
    }
  }

  function formatTime(ts){
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    const hh = String(d.getHours()).padStart(2,'0');
    const mm = String(d.getMinutes()).padStart(2,'0');
    const ss = String(d.getSeconds()).padStart(2,'0');
    return `${y}-${m}-${day}_${hh}-${mm}-${ss}`;
  }

  function formatDuration(ms){
    const totalSeconds = Math.floor(ms/1000);
    const minutes = String(Math.floor(totalSeconds/60)).padStart(2,'0');
    const seconds = String(totalSeconds%60).padStart(2,'0');
    return `${minutes}:${seconds}`;
  }

  function runCountdown(seconds){
    return new Promise(resolve => {
      if(seconds<=0) return resolve();
      const overlay = document.createElement('div');
      overlay.style.position = 'fixed';
      overlay.style.inset = '0';
      overlay.style.display = 'grid';
      overlay.style.placeItems = 'center';
      overlay.style.background = 'rgba(0,0,0,.35)';
      overlay.style.backdropFilter = 'blur(2px)';
      overlay.style.zIndex = '9999';
      const bubble = document.createElement('div');
      bubble.style.fontSize = '64px';
      bubble.style.fontWeight = '700';
      bubble.style.color = '#e7ecf3';
      bubble.style.textShadow = '0 6px 24px rgba(0,0,0,.5)';
      overlay.appendChild(bubble);
      document.body.appendChild(overlay);
      let left = seconds;
      bubble.textContent = String(left);
      const t = setInterval(()=>{
        left -= 1;
        if(left<=0){
          clearInterval(t);
          overlay.remove();
          resolve();
        } else {
          bubble.textContent = String(left);
        }
      }, 1000);
    });
  }

  async function startRecording(){
    try{
      const fps = Number(optFps.value) || 60;
      const countdown = Number(optCountdown.value) || 0;

      if(countdown > 0){
        await runCountdown(countdown);
      }

      setStatus('Requesting screen...');
      displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: fps } },
        audio: true
      });

      // If exists, use a muted microphone to avoid echo if desired (optional)
      // const mic = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      // const combined = new MediaStream([
      //   ...displayStream.getVideoTracks(),
      //   ...displayStream.getAudioTracks(),
      //   // ...mic.getAudioTracks(), // if you want mic too
      // ]);
      let combined = displayStream;
      // Mix microphone if enabled
      if(optMic.checked){
        try{
          const mic = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          const mixedStream = new MediaStream();
          displayStream.getVideoTracks().forEach(t=>mixedStream.addTrack(t));
          // Prefer display audio if present, then mic
          const displayAudioTracks = displayStream.getAudioTracks();
          if(displayAudioTracks.length){
            displayAudioTracks.forEach(t=>mixedStream.addTrack(t));
          }
          mic.getAudioTracks().forEach(t=>mixedStream.addTrack(t));
          combined = mixedStream;
        }catch(e){
          console.warn('Microphone not available or permission denied');
        }
      }

      previewEl.srcObject = combined;
      const options = { mimeType: 'video/webm;codecs=vp9,opus' };
      recordedChunks = [];
      try {
        mediaRecorder = new MediaRecorder(combined, options);
      } catch(e){
        // Fallback if codec unsupported
        mediaRecorder = new MediaRecorder(combined);
      }

      mediaRecorder.ondataavailable = (e)=>{
        if(e.data && e.data.size > 0){
          recordedChunks.push(e.data);
        }
      };
      let recordStartedAt = 0;
      let timerInterval = null;

      mediaRecorder.onstart = ()=>{
        setStatus('Recording...');
        enableWhileRecording();
        recordStartedAt = Date.now();
        timerInterval = setInterval(()=>{
          const ms = Date.now() - recordStartedAt;
          liveTimer.textContent = formatDuration(ms);
        }, 200);
      };
      mediaRecorder.onpause = ()=>{
        setStatus('Paused');
        btnPause.disabled = true;
        btnResume.disabled = false;
      };
      mediaRecorder.onresume = ()=>{
        setStatus('Recording...');
        btnPause.disabled = false;
        btnResume.disabled = true;
      };
      mediaRecorder.onstop = ()=>{
        setStatus('Stopped');
        enableIdle();
        liveTimer.textContent = '00:00';
        if(timerInterval) clearInterval(timerInterval);
        if(displayStream){
          displayStream.getTracks().forEach(t=>t.stop());
          displayStream = null;
        }
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        lastVideoBlobUrl = URL.createObjectURL(blob);
        addVideoToGallery(lastVideoBlobUrl, blob);
        ensureGalleryState();
      };

      mediaRecorder.start(250); // gather data in chunks

      // Stop recording if the user stops sharing via browser UI
      const [videoTrack] = combined.getVideoTracks();
      if(videoTrack){
        videoTrack.addEventListener('ended', ()=>{
          if(mediaRecorder && mediaRecorder.state !== 'inactive'){
            mediaRecorder.stop();
          }
        });
      }
    }catch(err){
      console.error(err);
      setStatus('Permission denied or no screen selected.');
      enableIdle();
    }
  }

  function pauseRecording(){
    if(mediaRecorder && mediaRecorder.state === 'recording'){
      mediaRecorder.pause();
    }
  }

  function resumeRecording(){
    if(mediaRecorder && mediaRecorder.state === 'paused'){
      mediaRecorder.resume();
    }
  }

  function stopRecording(){
    if(mediaRecorder && mediaRecorder.state !== 'inactive'){
      mediaRecorder.stop();
    }
  }

  async function captureScreenshot(){
    try{
      if(!previewEl.srcObject){
        return;
      }
      const videoTrack = previewEl.srcObject.getVideoTracks()[0];
      if(!videoTrack){ return; }
      const settings = videoTrack.getSettings();
      const width = settings.width || 1280;
      const height = settings.height || 720;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(previewEl, 0, 0, width, height);

      canvas.toBlob((blob)=>{
        if(!blob) return;
        const url = URL.createObjectURL(blob);
        addImageToGallery(url, blob);
        ensureGalleryState();
      }, 'image/png');
    } catch(err){
      console.error(err);
      setStatus('Failed to capture screenshot.');
    }
  }

  function addVideoToGallery(objectUrl, blob){
    const when = formatTime(Date.now());
    const card = document.createElement('div');
    card.className = 'card';
    const video = document.createElement('video');
    video.className = 'thumb';
    video.src = objectUrl;
    video.controls = true;
    video.playsInline = true;

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `Recording — ${when}`;

    const actions = document.createElement('div');
    actions.className = 'actions';

    const a = document.createElement('a');
    a.className = 'link';
    a.href = objectUrl;
    a.download = `screenly-${when}.webm`;
    a.textContent = 'Download';
    actions.appendChild(a);

    card.appendChild(video);
    card.appendChild(meta);
    card.appendChild(actions);
    if(galleryGrid.querySelector('.empty')) galleryGrid.innerHTML = '';
    galleryGrid.prepend(card);
  }

  function addImageToGallery(objectUrl, blob){
    const when = formatTime(Date.now());
    const card = document.createElement('div');
    card.className = 'card';
    const img = document.createElement('img');
    img.className = 'thumb';
    img.src = objectUrl;
    img.alt = 'Screenshot';

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `Screenshot — ${when}`;

    const actions = document.createElement('div');
    actions.className = 'actions';

    const a = document.createElement('a');
    a.className = 'link';
    a.href = objectUrl;
    a.download = `screenly-${when}.png`;
    a.textContent = 'Download';
    actions.appendChild(a);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'link';
    copyBtn.type = 'button';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', async ()=>{
      try{
        const resp = await fetch(objectUrl);
        const blob = await resp.blob();
        await navigator.clipboard.write([
          new ClipboardItem({ [blob.type]: blob })
        ]);
        setStatus('Screenshot copied to clipboard');
      }catch(e){
        setStatus('Copy failed. Your browser may not support writing images.');
      }
    });
    actions.appendChild(copyBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'link';
    delBtn.type = 'button';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', ()=>{
      URL.revokeObjectURL(objectUrl);
      card.remove();
      ensureGalleryState();
    });
    actions.appendChild(delBtn);

    card.appendChild(img);
    card.appendChild(meta);
    card.appendChild(actions);
    if(galleryGrid.querySelector('.empty')) galleryGrid.innerHTML = '';
    galleryGrid.prepend(card);
  }

  function clearGallery(){
    galleryGrid.innerHTML = '';
    ensureGalleryState();
  }

  // Wire up events
  btnStart.addEventListener('click', startRecording);
  btnPause.addEventListener('click', pauseRecording);
  btnResume.addEventListener('click', resumeRecording);
  btnStop.addEventListener('click', stopRecording);
  btnScreenshot.addEventListener('click', captureScreenshot);
  btnDownloadLast.addEventListener('click', ()=>{
    if(lastVideoBlobUrl){
      const a = document.createElement('a');
      a.href = lastVideoBlobUrl;
      a.download = `screenly-${formatTime(Date.now())}.webm`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  });
  btnClearGallery.addEventListener('click', clearGallery);

  // Initialize UI
  enableIdle();
  ensureGalleryState();
})();


