/**
 * Agenda Juridică – Proxy SOAP portal.just.ro
 * Fișier: api/portal.js  (merge în backend-ul Vercel)
 *
 * Rulează NON-STOP pe Vercel. Nu trebuie pornit zilnic.
 */
const http = require('http');

function soapEnv(body) {
  return `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${body}</soap:Body></soap:Envelope>`;
}
function x(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function buildCautareDosare({numarDosar,obiectDosar,numeParte,institutie,dataStart,dataStop}) {
  const ns='xmlns="portalquery.just.ro"';
  return soapEnv(`<CautareDosare ${ns}>${numarDosar?`<numarDosar>${x(numarDosar)}</numarDosar>`:'<numarDosar xsi:nil="true"/>'}${obiectDosar?`<obiectDosar>${x(obiectDosar)}</obiectDosar>`:'<obiectDosar xsi:nil="true"/>'}${numeParte?`<numeParte>${x(numeParte)}</numeParte>`:'<numeParte xsi:nil="true"/>'}${institutie?`<institutie>${x(institutie)}</institutie>`:'<institutie xsi:nil="true"/>'}${dataStart?`<dataStart>${x(dataStart)}</dataStart>`:'<dataStart xsi:nil="true"/>'}${dataStop?`<dataStop>${x(dataStop)}</dataStop>`:'<dataStop xsi:nil="true"/>'}</CautareDosare>`);
}
function buildCautareSedinte({dataSedinta,institutie}) {
  return soapEnv(`<CautareSedinte xmlns="portalquery.just.ro"><dataSedinta>${x(dataSedinta)}</dataSedinta><institutie>${x(institutie)}</institutie></CautareSedinte>`);
}
function buildHelloWorld() { return soapEnv('<HelloWorld xmlns="portalquery.just.ro"/>'); }

function callSoap(action, envelope) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(envelope, 'utf-8');
    const req = http.request({ hostname:'portalquery.just.ro', port:80, path:'/query.asmx', method:'POST',
      headers:{'Content-Type':'text/xml; charset=utf-8','SOAPAction':`"portalquery.just.ro/${action}"`,'Content-Length':buf.length}
    }, res => { let d=''; res.setEncoding('utf8'); res.on('data',c=>d+=c); res.on('end',()=>resolve(d)); });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout portal')); });
    req.write(buf); req.end();
  });
}

function getAll(xml, tag) { const re=new RegExp(`<(?:[^:>]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[^:>]+:)?${tag}>`,'g');const out=[];let m;while((m=re.exec(xml))!==null)out.push(m[1]);return out; }
function getOne(xml, tag) { const m=new RegExp(`<(?:[^:>]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[^:>]+:)?${tag}>`).exec(xml);return m?m[1].trim():null; }
function isNil(xml, tag) { return new RegExp(`<(?:[^:>]+:)?${tag}[^>]+xsi:nil="true"`).test(xml); }

function parseSed(xml) { return { complet:getOne(xml,'complet')||'', data:getOne(xml,'data')||'', ora:getOne(xml,'ora')||'', solutie:getOne(xml,'solutie')||'', solutieSumar:getOne(xml,'solutieSumar')||'', dataPronuntare:isNil(xml,'dataPronuntare')?null:getOne(xml,'dataPronuntare'), numarDocument:getOne(xml,'numarDocument')||'' }; }
function parseDosar(xml) { return { numar:getOne(xml,'numar')||'', numarVechi:getOne(xml,'numarVechi')||'', data:getOne(xml,'data')||'', institutie:getOne(xml,'institutie')||'', departament:getOne(xml,'departament')||'', categorieCaz:getOne(xml,'categorieCaz')||'', stadiuProcesual:getOne(xml,'stadiuProcesual')||'', obiect:getOne(xml,'obiect')||'', parti:getAll(xml,'DosarParte').map(p=>({nume:getOne(p,'nume')||'',calitateParte:getOne(p,'calitateParte')||''})), sedinte:getAll(xml,'DosarSedinta').map(parseSed), caiAtac:getAll(xml,'DosarCaleAtac').map(c=>({dataDeclarare:isNil(c,'dataDeclarare')?null:getOne(c,'dataDeclarare'),parteDeclaratoare:getOne(c,'parteDeclaratoare')||'',tipCaleAtac:getOne(c,'tipCaleAtac')||''})) }; }
function parseSedintaC(xml) { return { departament:getOne(xml,'departament')||'', complet:getOne(xml,'complet')||'', data:getOne(xml,'data')||'', ora:getOne(xml,'ora')||'', dosare:getAll(xml,'SedintaDosar').map(s=>({numar:getOne(s,'numar')||'',data:getOne(s,'data')||'',ora:getOne(s,'ora')||'',categorieCaz:getOne(s,'categorieCaz')||'',stadiuProcesual:getOne(s,'stadiuProcesual')||''})) }; }

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method==='OPTIONS') return res.status(200).end();
  if (req.method!=='POST') return res.status(405).json({eroare:'Foloseste POST'});

  let body = req.body;
  if (!body) {
    try { const chunks=[]; for await (const c of req) chunks.push(c); body=JSON.parse(Buffer.concat(chunks).toString()); }
    catch { return res.status(400).json({eroare:'Body JSON invalid'}); }
  }

  const {metoda} = body||{};
  try {
    let envelope, action, parse;
    if (metoda==='CautareDosare') {
      envelope=buildCautareDosare(body); action='CautareDosare';
      parse=xml=>{const r=getOne(xml,'CautareDosareResult');return r?getAll(r,'Dosar').map(parseDosar):[];};
    } else if (metoda==='CautareSedinte') {
      envelope=buildCautareSedinte(body); action='CautareSedinte';
      parse=xml=>{const r=getOne(xml,'CautareSedinteResult');return r?getAll(r,'Sedinta').map(parseSedintaC):[];};
    } else if (metoda==='HelloWorld') {
      envelope=buildHelloWorld(); action='HelloWorld';
      parse=xml=>({mesaj:getOne(xml,'HelloWorldResult')||''});
    } else {
      return res.status(400).json({eroare:`Metoda necunoscuta: ${metoda}`});
    }
    const xml = await callSoap(action, envelope);
    const result = parse(xml);
    return res.status(200).json({ok:true, result});
  } catch(err) {
    console.error('[portal.js]', err.message);
    return res.status(500).json({ok:false, eroare:err.message});
  }
};
