'use strict';
(function () {
  const queuedEvents=[];
  let receive=null;
  window.NativeEvent=function(event){try{const e=typeof event==='string'?JSON.parse(event):event;if(receive)receive(e);else queuedEvents.push(e);}catch(_){}};
  const $=id=>document.getElementById(id);
  const bridge=window.Native||null;
  const C=window.RhetoricCore;
  let profile=C.settings({});
  try{profile=C.settings(JSON.parse(bridge?bridge.loadSettings():(localStorage.getItem('rhetoric-settings')||'{}')));}catch(_){}
  const session=new C.Session(profile);
  let speaker='unknown',engineReady=false,capabilities={speechAvailable:false};
  let nativeReady=!bridge,engineCheckPending=false,engineCheckPort=null,inputNeedsReview=false;
  let toastTimer,saveTimer,restartTimer,requestTimer,readyTimer,engineTimer;
  let speechWanted=false,listening=false,speechErrors=0,lastSpeech='',lastSpeechAt=0;
  let preparation=null,preparationSequence=0,preparationTimer=null,preparationStatus='Prepare before a call',preparationCompleted=false;
  const settingKeys=['goal','compromise','boundaries','scenario','tone','inputLanguage','outputLanguage'];
  const field=(key)=>key==='port'?$('enginePort'):$(key);
  function native(name,...args){if(!bridge||typeof bridge[name]!=='function')return false;try{return bridge[name](...args);}catch(e){toast('Could not complete that action: '+e.message);return false;}}
  function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
  function cancel(invalidatePrepared){cancelPreparation(undefined,!!invalidatePrepared);clearTimeout(requestTimer);if(session.active)native('cancelGeneration');session.invalidate();}
  function renderPreparation(){
    $('prepareGuide').disabled=!bridge||!nativeReady||!engineReady||!capabilities.preparationAvailable||!!session.active||inputNeedsReview;
    $('prepareGuide').textContent=preparation?'Stop preparation':'Prepare guide';
    $('prepareGuide').classList.toggle('preparing',!!preparation);
    $('preparationStatus').textContent=preparationStatus;
  }
  function cancelPreparation(status,invalidateCompleted){
    if(!preparation&&preparationCompleted&&!invalidateCompleted){renderPreparation();return;}
    const running=preparation;preparation=null;clearTimeout(preparationTimer);preparationTimer=null;
    preparationStatus=status||'Prepare before a call';preparationCompleted=false;
    if(running)native('cancelGeneration');
    renderPreparation();
  }
  function prepareGuide(){
    if(preparation){cancelPreparation('Preparation cancelled');return;}
    if(!bridge||!nativeReady||!engineReady||!capabilities.preparationAvailable||session.active||inputNeedsReview)return;
    if(typeof C.preparationPayload!=='function'){preparationStatus='Preparation unavailable';renderPreparation();return;}
    const id='prep-'+(++preparationSequence)+'-'+session.revision;
    const payload=C.preparationPayload(profile,session.turns,id);
    preparation={id,port:profile.port,revision:session.revision};preparationCompleted=false;preparationStatus='Preparing…';renderPreparation();
    preparationTimer=setTimeout(()=>{if(preparation&&preparation.id===id){cancelPreparation('Preparation timed out');toast('Preparation timed out. Check Termux and retry.');}},90000);
    if(native('prepareGuide',JSON.stringify(payload))===false){cancelPreparation('Preparation failed');toast('The app could not prepare the guide. Check the local engine and retry.');}
  }
  function receivePreparation(event){
    if(!preparation||event.requestId!==preparation.id||preparation.port!==profile.port||preparation.revision!==session.revision)return;
    if(event.phase==='start')preparationStatus='Preparing…';
    else if(['done','error','cancelled'].includes(event.phase)){
      preparation=null;clearTimeout(preparationTimer);preparationTimer=null;
      if(event.phase==='done'){preparationCompleted=true;preparationStatus='Prepared · '+(Math.max(0,Number(event.elapsedMs)||0)/1000).toFixed(1)+' sec';}
      else if(event.phase==='error'){preparationStatus='Preparation failed';toast(event.message||'Guide preparation failed. Check Termux and retry.');}
      else preparationStatus='Preparation cancelled';
    }
    renderPreparation();
  }
  function save(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{const saved={...profile,captionCapture:false};if(bridge)native('saveSettings',JSON.stringify(saved));else try{localStorage.setItem('rhetoric-settings',JSON.stringify(saved));}catch(_){}},200);}
  function renderCompromise(){const allowed=!!profile.allowCompromise;$('compromise').disabled=!allowed;$('fallbackSection').classList.toggle('inactive',!allowed);$('compromiseStatus').textContent=allowed?'This alternative may be suggested. Your hard limits still apply.':'Not used. Enable “Allow compromise now” to use this field. Hard limits belong above.';}
  function populate(){settingKeys.forEach(key=>field(key).value=profile[key]);$('enginePort').value=String(profile.port);$('continuous').checked=profile.continuous;$('allowCompromise').checked=profile.allowCompromise;$('captionCapture').checked=false;renderCompromise();}
  function setEngineStatus(ready,message,model){if(!ready)cancelPreparation(undefined,true);clearTimeout(engineTimer);engineCheckPending=false;engineReady=!!ready;$('connectionText').textContent=ready?(profile.port===8081?'Local guide connected':'Genesis connected'):(bridge?'Local model not connected':'Preview mode');$('connection').classList.toggle('offline',!ready);$('engineDetail').textContent=model?model:(message||'Server unavailable');$('engineNotice').hidden=ready||!bridge;$('engineCommand').textContent=profile.port===8081?'rhetoric-start fast':'rhetoric-start custom';renderButtons();}
  function refreshCapabilities(){
    capabilities={speechAvailable:false};
    if(!bridge||!nativeReady)return capabilities;
    try{const response=native('capabilities');if(response)capabilities=JSON.parse(response);}catch(_){}
    return capabilities;
  }
  function checkEngine(){
    if(bridge&&!nativeReady){$('connectionText').textContent='Waiting for app connection';$('engineDetail').textContent='The Android app is still starting. Reopen it if this does not clear.';return;}
    if(engineCheckPending&&engineCheckPort===profile.port)return;
    if(preparation)cancelPreparation('Preparation cancelled');clearTimeout(engineTimer);engineCheckPending=!!bridge;engineCheckPort=profile.port;engineReady=false;
    $('connectionText').textContent=bridge?'Checking local engine':'Preview mode';renderButtons();
    if(!bridge){setEngineStatus(false,'Preview only — install the Android app.');return;}
    const port=profile.port;
    engineTimer=setTimeout(()=>{if(engineCheckPending&&engineCheckPort===port){setEngineStatus(false,'Engine check timed out. Start the server in Termux and tap Check to retry.');toast('Engine check timed out. Use Settings → Check after starting Termux.');}},15000);
    if(native('checkEngine',port)===false)setEngineStatus(false,'The app could not check the local engine. Reopen the app and retry.');
  }
  function receiveReady(){
    nativeReady=true;clearTimeout(readyTimer);refreshCapabilities();renderButtons();checkEngine();
    if(!capabilities.speechAvailable&&!listening)$('inputStatus').textContent='On-device speech unavailable · paste or import text, or install a speech pack.';
  }
  function updateProfile(){cancel(true);const beforeLanguage=profile.inputLanguage;settingKeys.forEach(key=>profile[key]=field(key).value);profile.port=Number($('enginePort').value);profile.continuous=$('continuous').checked;profile.allowCompromise=$('allowCompromise').checked;profile=C.settings(profile);session.setProfile(profile);renderCompromise();save();if(beforeLanguage!==profile.inputLanguage&&speechWanted)stopSpeech();renderResult();renderButtons();}
  function setSpeaker(value){speaker=['other','me'].includes(value)?value:'unknown';document.querySelectorAll('[data-speaker]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.speaker===speaker)));if(session.draft)session.draft.speaker=speaker;$('speakerWarning').hidden=!inputNeedsReview&&!(session.draft&&speaker==='unknown');renderButtons();}
  function renderButtons(){const text=$('utterance').value.trim();$('addTurn').disabled=!text||inputNeedsReview||text.length>6000;$('translateButton').disabled=!text||!engineReady||inputNeedsReview;$('coachButton').disabled=!session.active&&(!engineReady||!session.canCoach()||inputNeedsReview);$('coachButton').firstElementChild.textContent=session.active?'Stop generating':'Find my next line';$('coachButton').lastElementChild.textContent=session.active?'□':'↗';$('copyAnswer').disabled=!session.result||!session.result.text||session.result.stale||!!session.active;$('inputCount').textContent=String($('utterance').value.length)+' / 6000';$('micButton').disabled=!!bridge&&!nativeReady;renderPreparation();}
  function renderResult(){const active=session.active,result=session.result;const answer=$('answerText');answer.classList.toggle('empty',!active&&!result);answer.classList.toggle('streaming',!!active);answer.classList.toggle('stale',!!result&&result.stale&&!active);$('cushion').hidden=(!active||active.kind==='translation')&&!(result&&result.rejected&&!result.stale);if(active){const text=C.readableOutput(active.raw);answer.textContent=text||(active.kind==='translation'?'Translating locally…':'Finding a considered response…');$('resultStatus').textContent=active.phase==='streaming'?'Draft · generating':'Working on this phone';$('answerNote').textContent=active.kind==='translation'?'Local translation in progress.':'The text is still arriving. Review the completed suggestion.';$('answerHeading').textContent=active.kind==='translation'?'✦ TRANSLATION':'✦ YOUR NEXT LINE';}else if(result){answer.textContent=result.incomplete?'The response was cut short. Try a shorter passage or generate again.':result.rejected?'Could not produce a useful response. Try Custom Genesis.':(result.text||'No usable response arrived. Try again.');$('resultStatus').textContent=result.stale?'Context changed · refresh':result.incomplete?'Incomplete · discarded':result.rejected?'Repeated input · discarded':(result.elapsedMs?'Generation: '+(result.elapsedMs/1000).toFixed(1)+' sec':'Suggested · review first');$('answerNote').textContent=result.stale?'This suggestion uses older context. Generate a fresh one.':(result.rejected?'The model repeated their words. No suggestion was kept.':result.kind==='translation'?'Translation can miss nuance. Review its meaning.':'A suggestion to consider. The choice stays yours.');$('answerHeading').textContent=result.kind==='translation'?'✦ TRANSLATION':'✦ YOUR NEXT LINE';}else{answer.textContent='Bring a conversation.\nKeep your direction.';answer.style.whiteSpace='pre-line';$('resultStatus').textContent='Ready when you are';$('answerNote').textContent='A suggestion to consider. The choice stays yours.';$('answerHeading').textContent='✦ YOUR NEXT LINE';}renderButtons();}
  function renderTurns(){const container=$('turns');container.replaceChildren();session.turns.slice(-4).forEach(turn=>{const row=document.createElement('div');row.className='turn '+turn.speaker;const name=document.createElement('span');name.className='turn-label';name.textContent=(turn.speaker==='other'?'Other person':'Me')+(turn.text.length>250?' · final 250 characters':'');const text=document.createElement('p');text.textContent=turn.text.slice(-250);row.append(name,text);if(turn.text.length>250){const details=document.createElement('details');details.className='full-turn';const summary=document.createElement('summary');summary.textContent='Read full turn (not all sent to model)';const full=document.createElement('p');full.textContent=turn.text;details.append(summary,full);row.append(details);}container.append(row);});$('turnCount').textContent=session.turns.length?session.turns.length+' turn'+(session.turns.length===1?'':'s')+' · last 4 used':'No turns yet · session only';$('contextNote').hidden=!session.turns.slice(-4).some(t=>t.text.length>250);}
  function rejectIncomingText(text,message){
    cancel();inputNeedsReview=true;session.draft=null;
    if(text)$('utterance').value=String(text);
    setSpeaker('unknown');$('inputStatus').textContent=message;
    $('speakerWarning').textContent=message;$('speakerWarning').hidden=false;
    renderResult();toast(message);return false;
  }
  function stage(text,source,chosenSpeaker){
    if(String(text||'').trim().length>6000)return rejectIncomingText(text,'This text exceeds 6,000 characters. Edit or paste a shorter excerpt before coaching.');
    if(!String(text||'').trim())return false;
    cancel();inputNeedsReview=false;
    if(!session.stage(text,source,chosenSpeaker))return false;
    $('utterance').value=C.clean(text,6000);
    if(source==='caption')setSpeaker('unknown');else setSpeaker(chosenSpeaker||'unknown');
    $('inputStatus').textContent=source==='caption'?'Caption text · review words and speaker':source==='import'?'Imported text · review speaker':source==='speech'?'Recognized speech · review if needed':'Text ready to review';
    $('speakerWarning').textContent='Choose “Other person” or “Me” to review this text before coaching.';
    $('speakerWarning').hidden=speaker!=='unknown';renderResult();return true;
  }
  function commit(auto){const text=$('utterance').value.trim();if(inputNeedsReview){toast('Edit or paste a shorter excerpt before adding this turn.');return;}if(!text)return;if(speaker==='unknown'){$('speakerWarning').hidden=false;toast('Choose who said this first.');return;}cancelPreparation();if(!session.draft||session.draft.text!==text)session.stage(text,'typed',speaker);const turn=session.commit(speaker);if(!turn)return;$('utterance').value='';$('speakerWarning').hidden=true;$('inputStatus').textContent=turn.speaker==='me'?'Your turn added. Listen for their response.':'Other person’s turn added.';renderTurns();renderResult();setSpeaker('unknown');if(turn.speaker==='other'&&auto!==false&&engineReady)generate('coach');}
  function generate(kind){cancelPreparation(undefined,kind==='translation');if(inputNeedsReview){toast('Review a shorter excerpt before generating.');return;}if(session.active){cancel();renderResult();return;}if(kind==='translation'&&$('utterance').value.trim().length>300){toast('Translate up to 300 characters at a time. Use a shorter passage.');return;}if(!engineReady){toast('Start the local model in Termux, then check the engine.');return;}const payload=session.begin(kind,kind==='translation'?$('utterance').value:'');if(!payload){toast('Add and label the other person’s words first.');return;}renderResult();if(window.scrollY>80)$('answerText').scrollIntoView({behavior:'smooth',block:'center'});const id=payload.requestId;requestTimer=setTimeout(()=>{if(session.active&&session.active.id===id){native('cancelGeneration');session.invalidate();renderResult();$('resultStatus').textContent='Timed out';toast('The model took too long. Check Termux and try again.');}},90000);native('generate',JSON.stringify(payload));}
  function micState(){const on=listening||speechWanted;$('micButton').classList.toggle('listening',on);$('micLabel').textContent=on?'Stop':'Speak';$('micButton').setAttribute('aria-label',on?'Stop microphone':'Start microphone');}
  function stopSpeech(){speechWanted=false;listening=false;clearTimeout(restartTimer);restartTimer=null;native('stopListening');micState();$('inputStatus').textContent='Microphone stopped.';}
  function listen(){
    refreshCapabilities();
    if(!bridge||!nativeReady||!capabilities.speechAvailable){
      speechWanted=false;listening=false;clearTimeout(restartTimer);restartTimer=null;micState();
      toast(!bridge?'Microphone input is available in the installed Android app.':!nativeReady?'The app is still starting. Reopen it if this does not clear.':'No on-device speech recognizer is available. Install a speech pack or paste text instead.');
      return false;
    }
    clearTimeout(restartTimer);restartTimer=null;listening=true;micState();
    if(native('startListening',profile.inputLanguage)===false){speechWanted=false;listening=false;micState();return false;}
    return true;
  }
  function scheduleListen(delay){if(!speechWanted||!profile.continuous||restartTimer)return;restartTimer=setTimeout(()=>{restartTimer=null;if(speechWanted&&document.visibilityState!=='hidden')listen();},delay||700);}
  function onSpeech(event){if(event.phase==='listening'){listening=true;micState();$('inputStatus').textContent='Listening…';}else if(event.phase==='partial'){$('inputStatus').textContent=event.text?'Hearing: '+event.text.slice(-100):'Listening…';}else if(event.phase==='final'){listening=false;speechErrors=0;const text=String(event.text||'').trim();const now=Date.now();if(text&&(text!==lastSpeech||now-lastSpeechAt>1200)){lastSpeech=text;lastSpeechAt=now;const accepted=stage(text,'speech',speaker);if(accepted&&speaker!=='unknown'){commit(true);setSpeaker('unknown');}else{speechWanted=false;if(accepted)$('inputStatus').textContent='Listening paused · choose who spoke and add this turn.';}}if(profile.continuous&&speechWanted)scheduleListen(800);else speechWanted=false;micState();}else if(event.phase==='error'){listening=false;speechErrors++;$('inputStatus').textContent=event.message||'Speech recognition paused.';if(/denied|permission|unavailable|not supported|network/i.test(event.message||'')||speechErrors>=3){stopSpeech();toast(event.message||'Recognition paused after repeated errors. Tap Speak to retry.');}else if(profile.continuous&&speechWanted)scheduleListen(Math.min(12000,1200*Math.pow(2,speechErrors)));else{speechWanted=false;micState();toast(event.message||'No speech recognized. Tap Speak to retry.');}}else if(event.phase==='stopped'){listening=false;speechWanted=false;clearTimeout(restartTimer);restartTimer=null;micState();$('inputStatus').textContent=event.message||'Microphone stopped.';}}
  receive=function(event){if(!event||!event.type)return;if(event.type==='ready'){receiveReady();}else if(event.type==='preparation'){receivePreparation(event);}else if(event.type==='engine'){if(Number(event.port)===profile.port)setEngineStatus(event.ready,event.message,event.model);}else if(event.type==='generation'){const accepted=session.receive(event);if(!accepted)return;if(['done','error','cancelled'].includes(event.phase))clearTimeout(requestTimer);renderResult();if(event.phase==='error'){$('resultStatus').textContent='Could not generate';toast(event.message||'Local generation failed. Check the server in Termux.');}if(event.phase==='cancelled')$('resultStatus').textContent='Stopped';}else if(event.type==='speech')onSpeech(event);else if(event.type==='import'){if(event.text)stage(event.text,'import','unknown');else toast(event.message||'No text found in that file.');}else if(event.type==='caption'){if(event.overflow||event.truncated){stopSpeech();rejectIncomingText(event.text,event.status||'Caption is too long to review. Paste a shorter excerpt; earlier suggestions are now out of date.');}else if(event.text){stopSpeech();if(stage(event.text,'caption','unknown'))toast('Caption received. Review the words and choose the speaker.');}else if(event.status)toast(event.status);}else if(event.type==='share'){if(event.text)stage(event.text,'import','unknown');}};
  populate();
  settingKeys.forEach(key=>field(key).addEventListener(['goal','compromise','boundaries'].includes(key)?'input':'change',updateProfile));
  $('enginePort').addEventListener('change',()=>{updateProfile();checkEngine();});
  $('allowCompromise').addEventListener('change',updateProfile);
  $('continuous').addEventListener('change',()=>{updateProfile();if(!$('continuous').checked&&speechWanted)stopSpeech();});
  document.querySelectorAll('[data-speaker]').forEach(button=>button.addEventListener('click',()=>setSpeaker(button.dataset.speaker)));
  $('utterance').addEventListener('input',()=>{const text=$('utterance').value.trim();if(text.length>6000){rejectIncomingText(text,'This text exceeds 6,000 characters. Edit or paste a shorter excerpt before coaching.');return;}cancel();inputNeedsReview=false;if(text)session.stage(text,'typed',speaker);else session.draft=null;$('speakerWarning').textContent='Choose “Other person” or “Me” to review this text before coaching.';$('speakerWarning').hidden=speaker!=='unknown'||!text;renderResult();});
  $('addTurn').addEventListener('click',()=>commit(true));
  $('coachButton').addEventListener('click',()=>generate('coach'));
  $('translateButton').addEventListener('click',()=>generate('translation'));
  $('micButton').addEventListener('click',()=>{if(listening||speechWanted)stopSpeech();else{speechWanted=true;speechErrors=0;listen();}});
  $('copyAnswer').addEventListener('click',()=>{if(session.result&&session.result.text){if(bridge)native('copyText',session.result.text);else navigator.clipboard&&navigator.clipboard.writeText(session.result.text).catch(()=>{});toast('Suggestion copied.');}});
  $('copyCommand').addEventListener('click',()=>{native('copyText',$('engineCommand').textContent);toast('Command copied. Paste it into Termux.');});
  $('importButton').addEventListener('click',()=>{if(bridge)native('importText');else toast('Paste text below. File import is available in the Android app.');});
  $('clearSession').addEventListener('click',()=>{stopSpeech();cancel(true);session.clear();inputNeedsReview=false;$('utterance').value='';setSpeaker('unknown');$('inputStatus').textContent='Session cleared. Nothing from this conversation is saved.';renderTurns();renderResult();toast('Conversation cleared.');});
  $('settingsOpen').addEventListener('click',()=>$('settingsDialog').showModal());
  $('settingsClose').addEventListener('click',()=>$('settingsDialog').close());
  $('settingsDialog').addEventListener('click',event=>{if(event.target===$('settingsDialog')){const r=$('settingsDialog').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)$('settingsDialog').close();}});
  $('recheckEngine').addEventListener('click',checkEngine);
  $('prepareGuide').addEventListener('click',prepareGuide);
  $('captionSettings').addEventListener('click',()=>{if(bridge)native('openCaptionSettings');else toast('Accessibility settings are available in the Android app.');});
  $('captionCapture').addEventListener('change',()=>{if(!bridge){$('captionCapture').checked=false;toast('Caption capture requires the Android app and an accessible caption view.');return;}native('setCaptionCapture',$('captionCapture').checked);if($('captionCapture').checked)toast('Enable the caption accessibility service if prompted.');});
  $('resetSettings').addEventListener('click',()=>{cancel(true);stopSpeech();profile=C.settings({});session.setProfile(profile);populate();native('setCaptionCapture',false);save();checkEngine();renderResult();toast('Saved preferences reset.');});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){cancelPreparation('Preparation cancelled',true);stopSpeech();}else if(bridge&&nativeReady){refreshCapabilities();checkEngine();}});
  window.addEventListener('pagehide',()=>{stopSpeech();cancel(true);native('setCaptionCapture',false);});
  if(bridge){
    $('connectionText').textContent='Waiting for app connection';
    readyTimer=setTimeout(()=>{if(!nativeReady){$('connectionText').textContent='App startup incomplete';$('connection').classList.add('offline');$('engineDetail').textContent='Close and reopen the app to reconnect its interface.';toast('App startup did not complete. Close and reopen Live Rhetoric.');}},8000);
  }else{$('previewNotice').hidden=false;$('deviceLabel').textContent='LAYOUT PREVIEW';}
  renderTurns();renderResult();if(!bridge)checkEngine();queuedEvents.splice(0).forEach(receive);
})();
