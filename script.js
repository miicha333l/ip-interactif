"use strict";

let lastUsableIPs = [];
let currentPage = 1;
const pageSize = 50;
const MAX_GENERATE = 200000; // sécurité : limite de génération d'IP

// utilitaires d'ip <-> nombre 32 bits
function ipToNumber(ip){
  const p = ip.split('.').map(Number);
  return ((p[0]*256 + p[1])*256 + p[2])*256 + p[3];
}
function numberToIp(n){
  const a = Math.floor(n / (256**3));
  n -= a * (256**3);
  const b = Math.floor(n / (256**2));
  n -= b * (256**2);
  const c = Math.floor(n / 256);
  const d = n % 256;
  return `${a}.${b}.${c}.${d}`;
}

function validateIP(ip){
  if(!ip || typeof ip !== 'string') return false;
  const p = ip.split('.');
  if(p.length !== 4) return false;
  for(const x of p){ const n = Number(x); if(!Number.isInteger(n) || n < 0 || n > 255) return false; }
  return true;
}

function prefixToMaskArray(prefix){
  const bits = '1'.repeat(prefix) + '0'.repeat(32 - prefix);
  const mask = [];
  for(let i=0;i<32;i+=8) mask.push(parseInt(bits.slice(i,i+8),2));
  return mask;
}
function prefixToMaskNumber(prefix){
  const arr = prefixToMaskArray(prefix);
  return ((arr[0]*256 + arr[1])*256 + arr[2])*256 + arr[3];
}

// calcul principal : réseau, broadcast, range, sous-réseaux
function calculateIPs(ip, prefix){
  const ipNum = ipToNumber(ip);
  const maskNum = prefixToMaskNumber(prefix);
  const hostCountTotal = Math.pow(2, 32 - prefix);
  const usableHostCount = Math.max(hostCountTotal - 2, 0);

  const networkNum = ipNum & maskNum;
  const broadcastNum = networkNum + hostCountTotal - 1;

  const firstNum = usableHostCount > 0 ? networkNum + 1 : null;
  const lastNum = usableHostCount > 0 ? broadcastNum - 1 : null;

  // génération d'IPs utilisables (limité pour éviter freeze)
  let usableIPs = [];
  if(usableHostCount > 0){
    if(usableHostCount <= MAX_GENERATE){
      for(let n = firstNum; n <= lastNum; n++) usableIPs.push(numberToIp(n));
    } else {
      // si trop grand, on renvoie un message mais pas la liste complète
      usableIPs = [`(trop de hosts: ${usableHostCount} — liste non générée)`];
    }
  }

  // sous-réseaux : on divise en deux (prefix+1) et on crée mini-entries
  const subnets = [];
  if(prefix < 31){
    const newPrefix = prefix + 1;
    const step = Math.pow(2, 32 - newPrefix);
    for(let start = networkNum; start <= broadcastNum; start += step){
      subnets.push({ networkNum: start, prefix: newPrefix, networkIp: numberToIp(start) });
    }
  }

  return {
    ip, prefix,
    maskArray: prefixToMaskArray(prefix),
    mask: numberToIp(prefixToMaskNumber(prefix)),
    networkIp: numberToIp(networkNum),
    broadcastIp: numberToIp(broadcastNum),
    networkNum, broadcastNum,
    firstIp: firstNum ? numberToIp(firstNum) : null,
    lastIp: lastNum ? numberToIp(lastNum) : null,
    hosts: usableHostCount,
    usableIPs,
    subnets
  };
}

// rendu table (avec filtre + pagination simple)
function renderTable(page=1){
  const filter = document.getElementById('filter').value.trim();
  const filtered = lastUsableIPs.filter(ip => ip.includes(filter));
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if(page > totalPages) page = totalPages;
  const start = (page-1)*pageSize;
  const slice = filtered.slice(start, start + pageSize);

  let html = '<table><thead><tr><th>IP utilisable</th></tr></thead><tbody>';
  if(slice.length === 0) html += '<tr><td style="padding:12px">Aucune IP à afficher</td></tr>';
  else for(const ip of slice) html += `<tr><td>${ip}</td></tr>`;
  html += '</tbody></table>';
  document.getElementById('tableContainer').innerHTML = html;

  // pagination
  const pag = document.getElementById('pagination');
  let phtml = '';
  for(let i=1;i<=totalPages;i++){
    phtml += `<span class="page-btn ${i===page?'active':''}" data-page="${i}">${i}</span>`;
  }
  pag.innerHTML = phtml;

  // bind page buttons (delegation simple)
  pag.querySelectorAll('.page-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = Number(btn.getAttribute('data-page'));
      currentPage = p;
      renderTable(p);
    });
  });
}

// diagramme principal (limite affichage si trop d'ips)
function renderDiagram(result){
  const container = document.getElementById('networkDiagram');
  container.innerHTML = '';

  const title = document.createElement('div');
  title.innerHTML = `<strong>Réseau :</strong> ${result.networkIp} /${result.prefix} — <strong>Hosts :</strong> ${result.hosts}`;
  title.style.marginBottom = '8px';
  container.appendChild(title);

  // si la liste est trop grosse on évite d'afficher milliers de boxes
  if(result.hosts > 2000){
    const notice = document.createElement('div');
    notice.textContent = `Réseau trop grand pour afficher toutes les cases (${result.hosts} hosts). Utilisez les sous-réseaux ou filtrez.`;
    notice.style.padding = '8px';
    container.appendChild(notice);
    return;
  }

  // affiche réseau, hosts et broadcast
  const wrapper = document.createElement('div');
  // network box
  const netBox = document.createElement('div'); netBox.className = 'ipBox networkColor'; netBox.title = result.networkIp; netBox.textContent = result.networkIp.split('.')[3];
  netBox.addEventListener('click', ()=> showIPDetail(result.networkIp, 'network'));
  wrapper.appendChild(netBox);

  // hosts boxes (si list générée)
  if(Array.isArray(result.usableIPs) && result.usableIPs.length && !result.usableIPs[0].startsWith('(trop de hosts')){
    result.usableIPs.forEach(ip => {
      const b = document.createElement('div'); b.className = 'ipBox usableColor'; b.title = ip; b.textContent = ip.split('.')[3];
      b.addEventListener('click', ()=> showIPDetail(ip, 'usable'));
      wrapper.appendChild(b);
    });
  } else if(result.usableIPs.length && result.usableIPs[0].startsWith('(trop de hosts')){
    const info = document.createElement('div'); info.textContent = result.usableIPs[0]; info.style.padding='8px';
    wrapper.appendChild(info);
  }

  // broadcast
  const bc = document.createElement('div'); bc.className = 'ipBox broadcastColor'; bc.title = result.broadcastIp; bc.textContent = result.broadcastIp.split('.')[3];
  bc.addEventListener('click', ()=> showIPDetail(result.broadcastIp, 'broadcast'));
  wrapper.appendChild(bc);

  container.appendChild(wrapper);
}

// mini sous-réseaux cliquables
function renderSubnets(result){
  const container = document.getElementById('subnetDiagrams');
  container.innerHTML = '';
  if(!result.subnets.length) { container.innerHTML = ''; return; }
  result.subnets.forEach(s => {
    const block = document.createElement('div'); block.className = 'subnetDiagram';
    block.innerHTML = `<div style="font-size:13px;font-weight:600;margin-bottom:6px">${s.networkIp || s.networkIp}</div>`;
    // mini preview: create a few small boxes
    const preview = document.createElement('div'); preview.style.display = 'flex'; preview.style.gap='3px';
    // calculate data for this subnet
    const subRes = calculateIPs(s.networkIp, s.prefix);
    const items = [{ip: subRes.networkIp, type:'n'}].concat(
      (subRes.usableIPs.length && !subRes.usableIPs[0].startsWith('(trop de hosts)')) ? subRes.usableIPs.slice(0,8).map(ip=>({ip,type:'u'})) : []
    ).concat([{ip: subRes.broadcastIp, type:'b'}]);
    items.forEach(it => {
      const el = document.createElement('div'); el.className = 'ipBox ' + (it.type==='n'?'networkColor':it.type==='b'?'broadcastColor':'usableColor');
      el.title = it.ip; el.style.width='14px'; el.style.height='14px'; preview.appendChild(el);
    });
    block.appendChild(preview);

    block.addEventListener('click', ()=>{
      // zoom : afficher détail du sous-réseau
      showSubnetDetail(s.networkIp, s.prefix);
    });

    container.appendChild(block);
  });
}

// afficher détails d'une IP (panneau)
function showIPDetail(ip, type){
  const container = document.getElementById('networkDiagram');
  const detail = document.createElement('div');
  detail.style.marginTop = '10px';
  detail.style.padding = '10px';
  detail.style.border = '1px solid #e6eef7';
  detail.style.borderRadius = '8px';
  detail.style.background = '#fbfeff';
  detail.innerHTML = `<b>IP :</b> ${ip}<br><b>Type :</b> ${type}<br><b>Binaire :</b> ${ipToBinary(ip)}`;
  container.appendChild(detail);
}

// conversion simple ip -> binaire (string)
function ipToBinary(ip){
  return ip.split('.').map(x => Number(x).toString(2).padStart(8,'0')).join('.');
}

// zoom sur sous-réseau
function showSubnetDetail(networkIp, prefix){
  const res = calculateIPs(networkIp, prefix);
  lastUsableIPs = res.usableIPs && res.usableIPs[0] && res.usableIPs[0].startsWith('(trop de hosts') ? [] : res.usableIPs;
  renderTable(1);
  // replace networkDiagram with zoom view
  const container = document.getElementById('networkDiagram');
  container.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center">
    <div><strong>Sous-réseau</strong> : ${networkIp}/${prefix}</div>
    <button id="backBtn" style="padding:6px 8px;border-radius:6px;background:#0077b6;color:#fff;border:none;cursor:pointer">← Retour</button>
  </div>`;
  document.getElementById('backBtn').addEventListener('click', () => {
    // recalc principal if inputs exist
    document.getElementById('calculateBtn').click();
  });

  // now show the detail small grid
  renderDiagram(res);
}

// EXPORT helpers
function exportCSV(){
  if(!lastUsableIPs || lastUsableIPs.length === 0){ alert('Pas de données à exporter'); return; }
  const csv = "data:text/csv;charset=utf-8," + lastUsableIPs.join("\n");
  const a = document.createElement('a'); a.href = encodeURI(csv); a.download = "ips.csv"; document.body.appendChild(a); a.click(); a.remove();
}
function exportTXT(){
  if(!lastUsableIPs || lastUsableIPs.length === 0){ alert('Pas de données à exporter'); return; }
  const txt = "data:text/plain;charset=utf-8," + lastUsableIPs.join("\n");
  const a = document.createElement('a'); a.href = encodeURI(txt); a.download = "ips.txt"; document.body.appendChild(a); a.click(); a.remove();
}

// main bind (défensif)
document.addEventListener('DOMContentLoaded', () => {
  // listeners
  const calcBtn = document.getElementById('calculateBtn');
  calcBtn.addEventListener('click', () => {
    try {
      const ip = document.getElementById('ip').value.trim();
      const prefix = Number(document.getElementById('prefix').value);
      if(!validateIP(ip)){ alert('Adresse IP invalide'); return; }
      if(!Number.isInteger(prefix) || prefix < 0 || prefix > 32){ alert('Préfixe invalide (0-32)'); return; }

      const result = calculateIPs(ip, prefix);
      // update summary
      document.getElementById('summary').innerHTML = `
        <div><strong>IP:</strong> ${result.ip}/${result.prefix}</div>
        <div><strong>Masque:</strong> ${result.mask}</div>
        <div><strong>Réseau:</strong> ${result.networkIp}</div>
        <div><strong>Broadcast:</strong> ${result.broadcastIp}</div>
        <div><strong>Première:</strong> ${result.firstIp || '-'}</div>
        <div><strong>Dernière:</strong> ${result.lastIp || '-'}</div>
        <div><strong>Hôtes:</strong> ${result.hosts}</div>
      `;

      // set last usable IPs (if too many, lastUsableIPs becomes [] to avoid freeze)
      lastUsableIPs = (result.usableIPs && result.usableIPs[0] && result.usableIPs[0].startsWith('(trop de hosts')) ? [] : result.usableIPs;
      renderTable(1);
      renderSubnets(result);
      renderDiagram(result);
    } catch (err) {
      console.error(err);
      alert('Erreur inattendue (regarde la console développeur).');
    }
  });

  // exports
  document.getElementById('exportCSVBtn').addEventListener('click', exportCSV);
  document.getElementById('exportTXTBtn').addEventListener('click', exportTXT);

  // filter event
  document.getElementById('filter').addEventListener('input', () => renderTable(1));
});
