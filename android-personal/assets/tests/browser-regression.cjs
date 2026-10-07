// Run: RHETORIC_CHROMIUM=/path/to/chromium node assets/tests/browser-regression.cjs
// Requires Playwright. Native methods are mocked: this does not test an installed APK.
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');

(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.RHETORIC_CHROMIUM||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
  const entry=pathToFileURL(path.resolve(__dirname,'../index.html')).href;
  const pages=[];
  async function setup(options={}){
    const page=await browser.newPage({viewport:{width:393,height:852}});pages.push(page);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.clock.install();
    await page.addInitScript(opts=>{
      window.calls=[];window.nativeReady=false;window.dropped=0;window.speechAvailable=opts.speechAvailable!==false;window.holdEngine=false;
      window.Native={
        loadSettings:()=>JSON.stringify({continuous:true}),
        saveSettings:s=>calls.push(['save',JSON.parse(s)]),
        capabilities:()=>JSON.stringify({speechAvailable:window.speechAvailable}),
        checkEngine:port=>{calls.push(['check',port]);if(!nativeReady){dropped++;return;}if(!holdEngine)queueMicrotask(()=>NativeEvent({type:'engine',port,ready:true,model:'Test engine'}));},
        generate:s=>calls.push(['generate',JSON.parse(s)]),cancelGeneration:()=>calls.push(['cancel']),
        startListening:()=>calls.push(['listen']),stopListening:()=>calls.push(['stop']),
        copyText:()=>{},setCaptionCapture:()=>{},openCaptionSettings:()=>{},importText:()=>{}
      };
      window.deliverReady=()=>{window.nativeReady=true;NativeEvent({type:'ready',version:'0.1.1'});};
    },options);
    await page.goto(entry);
    return {page,errors};
  }
  try{
    const {page,errors}=await setup();
    assert.equal(await page.evaluate(()=>calls.filter(c=>c[0]==='check').length),0);
    assert.equal(await page.locator('#connectionText').textContent(),'Waiting for app connection');
    await page.evaluate(()=>deliverReady());
    assert.equal(await page.evaluate(()=>dropped),0);
    assert.equal(await page.locator('#connectionText').textContent(),'Local guide connected');
    console.log('PASS startup: no health request before native readiness; first ready event connects.');

    await page.locator('[data-speaker=other]').click();await page.locator('#micButton').click();
    await page.evaluate(()=>NativeEvent({type:'speech',phase:'final',text:'Could we schedule an appointment?'}));
    assert.equal(await page.evaluate(()=>calls.filter(c=>c[0]==='generate').length),1);
    assert.equal(await page.locator('[data-speaker=unknown]').getAttribute('aria-pressed'),'true');
    await page.clock.fastForward(850);
    assert.equal(await page.evaluate(()=>calls.filter(c=>c[0]==='listen').length),2);
    await page.evaluate(()=>NativeEvent({type:'speech',phase:'final',text:'Tomorrow might work for me.'}));
    await page.clock.fastForward(2000);
    assert.equal(await page.evaluate(()=>calls.filter(c=>c[0]==='listen').length),2);
    assert.equal(await page.evaluate(()=>calls.filter(c=>c[0]==='generate').length),1);
    assert.match(await page.locator('#inputStatus').textContent(),/paused/);
    console.log('PASS speech: one restart, then Unknown-speaker review pauses recognition and coaching.');

    await page.locator('#clearSession').click();await page.locator('#micButton').click();
    for(const delay of [2500,4900,15000]){await page.evaluate(()=>NativeEvent({type:'speech',phase:'error',message:'No speech recognized. Tap Listen to try again.'}));await page.clock.fastForward(delay);}
    assert.equal(await page.locator('#micLabel').textContent(),'Speak');
    assert.equal(await page.evaluate(()=>calls.filter(c=>c[0]==='listen').length),5);
    console.log('PASS speech errors: bounded retry/backoff, then stopped after three errors.');
    await page.locator('#micButton').click();const startsBeforeStop=await page.evaluate(()=>calls.filter(c=>c[0]==='listen').length);
    await page.evaluate(()=>NativeEvent({type:'speech',phase:'stopped',message:'Microphone remains stopped while the app is in the background.'}));
    await page.clock.fastForward(5000);assert.equal(await page.evaluate(()=>calls.filter(c=>c[0]==='listen').length),startsBeforeStop);
    assert.equal(await page.locator('#micLabel').textContent(),'Speak');
    console.log('PASS native stop: continuous mode cannot restart recognition after background/explicit stop.');

    await page.locator('#utterance').fill('Can we agree on a time?');await page.locator('[data-speaker=other]').click();await page.locator('#addTurn').click();
    let request=await page.evaluate(()=>calls.filter(c=>c[0]==='generate').at(-1)[1]);
    await page.evaluate(id=>NativeEvent({type:'generation',requestId:id,phase:'error',message:'Local engine is not running. Start it in Termux.'}),request.requestId);
    assert.equal(await page.locator('#resultStatus').textContent(),'Could not generate');
    assert.match(await page.locator('#toast').textContent(),/not running/);
    await page.clock.fastForward(5000);assert.equal(await page.locator('#resultStatus').textContent(),'Could not generate');
    await page.locator('#coachButton').click();request=await page.evaluate(()=>calls.filter(c=>c[0]==='generate').at(-1)[1]);
    await page.evaluate(id=>NativeEvent({type:'generation',requestId:id,phase:'done',text:'Partial words',truncated:true}),request.requestId);
    assert.match(await page.locator('#resultStatus').textContent(),/Incomplete/);assert.equal(await page.locator('#copyAnswer').isDisabled(),true);
    await page.locator('#coachButton').click();await page.clock.fastForward(90050);
    assert.equal(await page.locator('#resultStatus').textContent(),'Timed out');
    console.log('PASS model failures: persistent error feedback, incomplete-output rejection, visible timeout.');

    await page.locator('#coachButton').click();request=await page.evaluate(()=>calls.filter(c=>c[0]==='generate').at(-1)[1]);
    await page.evaluate(id=>NativeEvent({type:'generation',requestId:id,phase:'done',text:'Would tomorrow morning work for you?'}),request.requestId);
    await page.evaluate(()=>NativeEvent({type:'caption',text:'x'.repeat(6001),status:'captured'}));
    assert.equal(await page.locator('#utterance').inputValue(),'x'.repeat(6001));
    assert.match(await page.locator('#toast').textContent(),/exceeds 6,000/);
    assert.doesNotMatch(await page.locator('#toast').textContent(),/Caption received/);
    assert.match(await page.locator('#resultStatus').textContent(),/Context changed/);
    assert.equal(await page.locator('#coachButton').isDisabled(),true);assert.equal(await page.locator('#addTurn').isDisabled(),true);
    await page.locator('#utterance').fill('A reviewed short excerpt.');await page.locator('[data-speaker=other]').click();await page.locator('#addTurn').click();
    const latest=await page.evaluate(()=>calls.filter(c=>c[0]==='generate').at(-1)[1]);
    await page.evaluate(()=>NativeEvent({type:'caption',text:'',overflow:true,status:'Caption view exceeds the limit. Paste a shorter excerpt.'}));
    assert.match(await page.locator('#toast').textContent(),/exceeds the limit/);assert.equal(await page.locator('#coachButton').isDisabled(),true);
    await page.evaluate(id=>NativeEvent({type:'generation',requestId:id,phase:'done',text:'Old advice must not return.'}),latest.requestId);
    assert.doesNotMatch(await page.locator('#answerText').textContent(),/Old advice/);
    console.log('PASS caption overflow: no success toast, old result invalidated, active request cancelled, full oversized text retained for manual editing.');

    await page.evaluate(()=>window.holdEngine=true);await page.locator('#settingsOpen').click();await page.locator('#recheckEngine').click();await page.clock.fastForward(15100);
    assert.equal(await page.locator('#connectionText').textContent(),'Local model not connected');assert.match(await page.locator('#engineDetail').textContent(),/timed out/);
    await page.evaluate(()=>window.holdEngine=false);await page.locator('#recheckEngine').click();assert.equal(await page.locator('#connectionText').textContent(),'Local guide connected');
    assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    console.log('PASS health timeout: clear retry message and successful manual recovery; no JS errors or mobile overflow.');

    const {page:changed,errors:changedErrors}=await setup({speechAvailable:false});await changed.evaluate(()=>deliverReady());
    for(let i=0;i<2;i++){await changed.locator('#micButton').click();assert.match(await changed.locator('#toast').textContent(),/No on-device speech recognizer/);assert.equal(await changed.locator('#micLabel').textContent(),'Speak');}
    assert.equal(await changed.evaluate(()=>calls.filter(c=>c[0]==='listen').length),0);
    await changed.evaluate(()=>window.speechAvailable=true);await changed.locator('#micButton').click();
    assert.equal(await changed.evaluate(()=>calls.filter(c=>c[0]==='listen').length),1);
    await changed.locator('#micButton').click();await changed.evaluate(()=>{window.speechAvailable=false;deliverReady();});
    await changed.locator('#micButton').click();assert.equal(await changed.evaluate(()=>calls.filter(c=>c[0]==='listen').length),1);
    assert.deepEqual(changedErrors,[]);
    console.log('PASS microphone preflight: failed starts clear flags; newly available speech works without reload; resume refresh sees removal.');
    console.log('All browser regressions passed. Native bridge was simulated; installed APK, microphone hardware, Samsung captions and model quality were not tested.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
