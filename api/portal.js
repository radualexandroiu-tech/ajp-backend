// portal.js - Backend Vercel pentru Agenda Juridica
// Proxy SOAP pentru portalquery.just.ro

const http = require('http');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: false, eroare: 'Foloseste POST' });
  }

  let body = '';
  try {
    body = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });
  } catch (e) {
    return res.status(200).json({ ok: false, eroare: 'Eroare citire body: ' + e.message });
  }

  let params;
  try {
    params = JSON.parse(body);
  } catch (e) {
    return res.status(200).json({ ok: false, eroare: 'JSON invalid' });
  }

  const metoda = params.metoda || 'CautareDosare';

  // Construieste XML SOAP
  let soapBody = '';

  if (metoda === 'HelloWorld') {
    soapBody = '<HelloWorld xmlns="portalquery.just.ro" />';
  } else if (metoda === 'CautareDosare' || metoda === 'CautareDosare2') {
    const nr = params.numarDosar ? `<numarDosar>${escXml(params.numarDosar)}</numarDosar>` : '<numarDosar></numarDosar>';
    const ob = params.obiectDosar ? `<obiectDosar>${escXml(params.obiectDosar)}</obiectDosar>` : '<obiectDosar></obiectDosar>';
    const np = params.numeParte ? `<numeParte>${escXml(params.numeParte)}</numeParte>` : '<numeParte></numeParte>';
    const inst = params.institutie ? `<institutie>${escXml(params.institutie)}</institutie>` : '<institutie></institutie>';

    if (metoda === 'CautareDosare2') {
      soapBody = `<CautareDosare2 xmlns="portalquery.just.ro">${nr}${ob}${np}${inst}<dataStart></dataStart><dataStop></dataStop><dataUltimaModificareStart></dataUltimaModificareStart><dataUltimaModificareStop></dataUltimaModificareStop></CautareDosare2>`;
    } else {
      soapBody = `<CautareDosare xmlns="portalquery.just.ro">${nr}${ob}${np}${inst}<dataStart></dataStart><dataStop></dataStop></CautareDosare>`;
    }
  } else if (metoda === 'CautareSedinte') {
    soapBody = `<CautareSedinte xmlns="portalquery.just.ro"><dataSedinta>${escXml(params.dataSedinta || '')}</dataSedinta><institutie>${escXml(params.institutie || '')}</institutie></CautareSedinte>`;
  } else {
    return res.status(200).json({ ok: false, eroare: 'Metoda necunoscuta: ' + metoda });
  }

  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>${soapBody}</soap:Body>
</soap:Envelope>`;

  const action = `portalquery.just.ro/${metoda}`;

  // Trimite cererea SOAP catre portal cu timeout 25s
  let xmlRespuns;
  try {
    xmlRespuns = await soapPost(envelope, action, 25000);
  } catch (e) {
    // Daca CautareDosare esueaza, incearca CautareDosare2
    if (metoda === 'CautareDosare' && params.numarDosar) {
      try {
        const nr = `<numarDosar>${escXml(params.numarDosar)}</numarDosar>`;
        const ob = '<obiectDosar></obiectDosar>';
        const np = params.numeParte ? `<numeParte>${escXml(params.numeParte)}</numeParte>` : '<numeParte></numeParte>';
        const inst = params.institutie ? `<institutie>${escXml(params.institutie)}</institutie>` : '<institutie></institutie>';
        const env2 = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body><CautareDosare2 xmlns="portalquery.just.ro">${nr}${ob}${np}${inst}<dataStart></dataStart><dataStop></dataStop><dataUltimaModificareStart></dataUltimaModificareStart><dataUltimaModificareStop></dataUltimaModificareStop></CautareDosare2></soap:Body>
</soap:Envelope>`;
        xmlRespuns = await soapPost(env2, 'portalquery.just.ro/CautareDosare2', 25000);
      } catch (e2) {
        return res.status(200).json({ ok: false, eroare: 'Portal indisponibil: ' + e2.message });
      }
    } else {
      return res.status(200).json({ ok: false, eroare: 'Portal indisponibil: ' + e.message });
    }
  }

  // Parseaza XML
  try {
    const result = parseRaspuns(xmlRespuns, metoda);
    return res.status(200).json({ ok: true, result: result });
  } catch (e) {
    return res.status(200).json({ ok: false, eroare: 'Eroare parsare XML: ' + e.message, xml: xmlRaspuns ? xmlRaspuns.substring(0, 500) : '' });
  }
};

// ================================================================
// HTTP request catre portalquery.just.ro
// ================================================================
function soapPost(envelope, soapAction, timeout) {
  return new Promise((resolve, reject) => {
    const postData = Buffer.from(envelope, 'utf8');
    const options = {
      hostname: 'portalquery.just.ro',
      port: 80,
      path: '/query.asmx',
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'Content-Length': postData.length,
        'SOAPAction': '"' + soapAction + '"',
        'Host': 'portalquery.just.ro',
        'Accept': 'text/xml',
        'Connection': 'close'
      }
    };

    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error('Timeout dupa ' + (timeout / 1000) + 's'));
    }, timeout);

    const req = http.request(options, (resp) => {
      let data = '';
      resp.setEncoding('utf8');
      resp.on('data', chunk => { data += chunk; });
      resp.on('end', () => {
        clearTimeout(timer);
        if (resp.statusCode >= 400) {
          reject(new Error('HTTP ' + resp.statusCode));
        } else {
          resolve(data);
        }
      });
    });

    req.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error('Eroare conexiune: ' + e.message));
    });

    req.write(postData);
    req.end();
  });
}

// ================================================================
// Parsare XML raspuns
// ================================================================
function parseRaspuns(xml, metoda) {
  if (!xml) return [];

  if (metoda === 'HelloWorld') {
    const m = xml.match(/<HelloWorldResult>([\s\S]*?)<\/HelloWorldResult>/i);
    return m ? m[1] : 'OK';
  }

  if (metoda === 'CautareSedinte') {
    return parseSedinte(xml);
  }

  // CautareDosare sau CautareDosare2
  return parseDosare(xml);
}

function parseDosare(xml) {
  const dosare = [];
  // Extrage toate elementele Dosar
  const dosarRegex = /<Dosar[^>]*>([\s\S]*?)<\/Dosar>/gi;
  let match;
  while ((match = dosarRegex.exec(xml)) !== null) {
    const d = match[1];
    if (!d || d.includes('xsi:nil="true"')) continue;

    const dosar = {
      numar: getTag(d, 'numar'),
      numarVechi: getTag(d, 'numarVechi'),
      data: getTag(d, 'data'),
      institutie: getTag(d, 'institutie'),
      departament: getTag(d, 'departament'),
      categorieCaz: getTag(d, 'categorieCaz'),
      stadiuProcesual: getTag(d, 'stadiuProcesual'),
      obiect: getTag(d, 'obiect'),
      dataModificare: getTag(d, 'dataModificare'),
      parti: parseParti(d),
      sedinte: parseSedinteDin(d),
      caiAtac: parseCaiAtac(d)
    };

    if (dosar.numar) dosare.push(dosar);
  }
  return dosare;
}

function parseParti(xml) {
  const parti = [];
  const regex = /<DosarParte[^>]*>([\s\S]*?)<\/DosarParte>/gi;
  let m;
  while ((m = regex.exec(xml)) !== null) {
    const p = m[1];
    if (!p || p.includes('xsi:nil="true"')) continue;
    parti.push({
      nume: getTag(p, 'nume'),
      calitateParte: getTag(p, 'calitateParte')
    });
  }
  return parti;
}

function parseSedinteDin(xml) {
  const sedinte = [];
  // Extrage sectiunea <sedinte>...</sedinte>
  const secMatch = xml.match(/<sedinte[^>]*>([\s\S]*?)<\/sedinte>/i);
  if (!secMatch) return sedinte;
  const sec = secMatch[1];

  const regex = /<DosarSedinta[^>]*>([\s\S]*?)<\/DosarSedinta>/gi;
  let m;
  while ((m = regex.exec(sec)) !== null) {
    const s = m[1];
    if (!s || s.includes('xsi:nil="true"')) continue;
    sedinte.push({
      complet: getTag(s, 'complet'),
      data: getTag(s, 'data'),
      ora: getTag(s, 'ora'),
      solutie: getTag(s, 'solutie'),
      solutieSumar: getTag(s, 'solutieSumar'),
      dataPronuntare: getTag(s, 'dataPronuntare'),
      numarDocument: getTag(s, 'numarDocument')
    });
  }
  return sedinte;
}

function parseSedinte(xml) {
  const sedinte = [];
  const regex = /<Sedinta[^>]*>([\s\S]*?)<\/Sedinta>/gi;
  let m;
  while ((m = regex.exec(xml)) !== null) {
    const s = m[1];
    if (!s || s.includes('xsi:nil="true"')) continue;
    sedinte.push({
      complet: getTag(s, 'complet'),
      data: getTag(s, 'data'),
      ora: getTag(s, 'ora'),
      solutie: getTag(s, 'solutie'),
      solutieSumar: getTag(s, 'solutieSumar')
    });
  }
  return sedinte;
}

function parseCaiAtac(xml) {
  const cai = [];
  const secMatch = xml.match(/<caiAtac[^>]*>([\s\S]*?)<\/caiAtac>/i);
  if (!secMatch) return cai;
  const sec = secMatch[1];
  const regex = /<DosarCaleAtac[^>]*>([\s\S]*?)<\/DosarCaleAtac>/gi;
  let m;
  while ((m = regex.exec(sec)) !== null) {
    const c = m[1];
    if (!c || c.includes('xsi:nil="true"')) continue;
    cai.push({
      caleAtac: getTag(c, 'caleAtac'),
      data: getTag(c, 'data')
    });
  }
  return cai;
}

function getTag(xml, tag) {
  const m = xml.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
  if (!m) return '';
  return m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&quot;/g, '"').trim();
}

function escXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
