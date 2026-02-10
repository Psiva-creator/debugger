(async function(){
  const traceRes = await fetch('trace.json').then(r=>r.json());
  const src = traceRes.src || '';
  const events = traceRes.trace || [];
  document.getElementById('source').textContent = src;

  const eventsList = document.getElementById('events');
  events.forEach((e,i)=>{
    const li = document.createElement('li');
    li.dataset.index = i;
    li.textContent = `${i}: ${e.type}` + (e.nodeType?` (${e.nodeType})`: '');
    eventsList.appendChild(li);
  });

  const current = document.getElementById('current');
  let idx = 0; let timer = null;
  const speedInput = document.getElementById('speed');
  function render(i){
    const e = events[i] || { type: 'done' };
    current.textContent = JSON.stringify(e, null, 2);
    Array.from(eventsList.children).forEach(li=>li.classList.toggle('active', +li.dataset.index===i));
    eventsList.scrollTop = Math.max(0, (i-3))*28;
  }

  function play(){
    if(timer) return;
    timer = setInterval(()=>{
      render(idx);
      idx++;
      if(idx>=events.length){ clearInterval(timer); timer=null; }
    }, Number(speedInput.value));
  }
  function pause(){ if(timer){ clearInterval(timer); timer=null; } }

  document.getElementById('play').addEventListener('click', play);
  document.getElementById('pause').addEventListener('click', pause);
  render(0);
})();
