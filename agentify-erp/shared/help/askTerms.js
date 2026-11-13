// Ask: understand questions written in Roman Urdu / Hindi (Urdu in English letters) or Urdu script, with no AI call.
// The help guides are English, so a question is turned into English search words first. Filler words (kese, kar, sakta, hu...)
// are dropped so they do not count as "unmatched" words. Also detects which language an answer should come in.

// word -> English search words ('' = filler that carries no meaning for search)
const RU = {
  // question and grammar filler
  me: '', main: '', mein: '', mai: '', mujhe: '', mujhy: '', hum: '', ham: '', aap: '', apna: '', apni: '', apne: '', hai: '', hain: '', hy: '', hu: '', hun: '', ho: '', hota: '', hoti: '', hote: '', hoga: '', hogi: '', ka: '', ki: '', ke: '', ko: '', se: '', sy: '', par: '', pe: '', ye: '', yeh: '', wo: '', woh: '', is: '', us: '', aur: '', ya: '', bhi: '', to: '', toh: '', na: '', nahi: '', nahin: '', kia: '', kya: '', kaun: '', kab: '', kyun: '', kyu: '', kahan: 'where', kahaan: 'where', kidhar: 'where', kitna: 'how many', kitni: 'how many', kitne: 'how many', bata: '', batao: '', batain: '', bataen: '', btao: '', bataiye: '', samjhao: '', samjhain: '', dikhao: 'show', chahiye: '', chahta: '', chahti: '', chahte: '', liye: '', lye: '', wala: '', wali: '', wale: '', sath: '', tarah: '', tarha: '',
  pura: '', poora: '', pora: '', pory: '', pure: '', poore: '', pore: '', puray: '', saara: '', sara: '', sary: '', sare: '', mukammal: '', tamam: '',
  milegi: 'get', milega: 'get', milay: 'get', mile: 'get', milti: 'get', milta: 'get', milein: 'get', hasil: 'get', seekhna: 'training learn', sikhna: 'training learn', seekh: 'training learn', sikhao: 'training learn', training: 'training', tarbiyat: 'training', video: 'video', videos: 'video', tutorial: 'training video', guide: 'guide',
  kese: 'how', kaise: 'how', kasay: 'how', kesay: 'how', kaisay: 'how', kis: '', kisi: '', koi: '', kuch: '', sab: '',
  kar: 'do', karna: 'do', karne: 'do', karo: 'do', karen: 'do', karein: 'do', krna: 'do', krne: 'do', kr: 'do', karsakta: 'do', sakta: 'can', sakti: 'can', sakte: 'can', skta: 'can', skti: 'can', ssakta: 'can', ssakti: 'can',
  add: 'add', new: 'add', naya: 'add', nayi: 'add', nai: 'add', bana: 'create', banana: 'create', banao: 'create', banane: 'create', banain: 'create', create: 'create',
  dalna: 'add', dalni: 'add', dalein: 'add', dal: 'add', daal: 'add', daalna: 'add', shamil: 'add', jorna: 'add', jodna: 'add',
  edit: 'edit', badalna: 'change edit', badal: 'change edit', tabdeel: 'change edit', change: 'change edit',
  delete: 'delete', hatana: 'delete remove', hatao: 'delete remove', mitana: 'delete remove', mita: 'delete remove', khatam: 'delete close',
  dekhna: 'view', dekhni: 'view', dekhein: 'view', dekho: 'view', dekh: 'view', kholna: 'open', kholein: 'open', bhejna: 'send', bhejein: 'send', bhej: 'send', bhejni: 'send', lagana: 'apply', lagao: 'apply', nikalna: 'export download', nikalein: 'export download', download: 'download', upload: 'upload',
  save: 'save', print: 'print', setting: 'settings', settings: 'settings', sahi: '', galat: 'error problem', masla: 'problem error', masail: 'problem error', error: 'error',
  // meeting / people / office
  appointment: 'appointment', appointments: 'appointment', mulaqat: 'appointment meeting', mulaqaat: 'appointment meeting', meeting: 'meeting', meetings: 'meeting', visit: 'visit site visit', visits: 'visit site visit', daura: 'visit',
  lead: 'lead', leads: 'lead', contact: 'contact', contacts: 'contact', client: 'client customer', clients: 'client customer', customer: 'client customer', gahak: 'client customer', grahak: 'client customer', buyer: 'buyer', seller: 'seller', dealer: 'dealer', agent: 'agent', agents: 'agent',
  employee: 'employee', employees: 'employee', mulazim: 'employee staff', mulazmeen: 'employee staff', staff: 'staff', team: 'team', user: 'user', users: 'user', role: 'role permission', roles: 'role permission', permission: 'permission', ijazat: 'permission', password: 'password', login: 'login', logout: 'logout', profile: 'profile',
  task: 'task', tasks: 'task', kaam: 'task', notes: 'note', note: 'note', followup: 'follow up', follow: 'follow up', reminder: 'reminder', yaad: 'reminder',
  // money
  payment: 'payment', payments: 'payment', raqam: 'payment amount', paisay: 'payment money', paise: 'payment money', paisa: 'payment money', adaigi: 'payment', wasooli: 'payment collection receive', receive: 'receive payment', receipt: 'receipt', receipts: 'receipt', rasid: 'receipt', voucher: 'voucher', vouchers: 'voucher',
  invoice: 'invoice', bill: 'invoice bill', qist: 'installment', qisat: 'installment', qisten: 'installment', qiston: 'installment', installment: 'installment', installments: 'installment', kist: 'installment', expense: 'expense', expenses: 'expense', kharcha: 'expense', akhrajat: 'expense', commission: 'commission', salary: 'salary payroll', tankhwah: 'salary payroll', tankhuah: 'salary payroll', payroll: 'payroll', hisab: 'account ledger', hisaab: 'account ledger', khata: 'account ledger', ledger: 'ledger', vendor: 'vendor', supplier: 'vendor supplier', tax: 'tax', report: 'report', reports: 'report', rapat: 'report',
  // property / plot / project
  property: 'property', properties: 'property', jaidad: 'property', plot: 'plot', plots: 'plot', file: 'file', files: 'file', booking: 'booking', book: 'booking', unit: 'unit', units: 'unit', project: 'project', projects: 'project', society: 'society project', map: 'map', naqsha: 'map', listing: 'listing', listings: 'listing', publish: 'publish', website: 'website', zameen: 'plot land', makan: 'house property', ghar: 'house property', flat: 'flat apartment', shop: 'shop', dukan: 'shop', construction: 'construction', tameer: 'construction', site: 'site', sitevisit: 'site visit', material: 'material', stock: 'stock inventory', inventory: 'inventory',
  // other
  attendance: 'attendance', hazri: 'attendance', hazir: 'attendance', chutti: 'leave', leave: 'leave', document: 'document', documents: 'document', dastavez: 'document', email: 'email', sms: 'sms', whatsapp: 'whatsapp', call: 'call', calls: 'call', recording: 'recording', recordings: 'recording', calendar: 'calendar', dashboard: 'dashboard', language: 'language', zuban: 'language', plan: 'plan billing', billing: 'billing plan', subscription: 'subscription billing', trial: 'trial', backup: 'backup', import: 'import', excel: 'import export', csv: 'import export', export: 'export', notification: 'notification', notifications: 'notification', ai: 'ai', app: 'app', mobile: 'mobile app', phone: 'phone',
  // Urdu script
  'اپائنٹمنٹ': 'appointment', 'ملاقات': 'appointment meeting', 'میٹنگ': 'meeting', 'لیڈ': 'lead', 'لیڈز': 'lead', 'کلائنٹ': 'client customer', 'گاہک': 'client customer', 'ملازم': 'employee staff', 'تنخواہ': 'salary payroll', 'ادائیگی': 'payment', 'رقم': 'payment amount', 'رسید': 'receipt', 'وچر': 'voucher', 'انوائس': 'invoice', 'قسط': 'installment', 'اقساط': 'installment', 'خرچ': 'expense', 'اخراجات': 'expense', 'پلاٹ': 'plot', 'پراپرٹی': 'property', 'جائیداد': 'property', 'بکنگ': 'booking', 'پروجیکٹ': 'project', 'رپورٹ': 'report', 'ٹاسک': 'task', 'کام': 'task', 'حاضری': 'attendance', 'چھٹی': 'leave', 'کیسے': 'how', 'کیا': '', 'کہاں': 'where', 'کتنے': 'how many', 'شامل': 'add', 'بنانا': 'create', 'بنائیں': 'create', 'ڈالنا': 'add', 'ڈیلیٹ': 'delete', 'مٹانا': 'delete remove', 'دیکھنا': 'view', 'دیکھیں': 'view', 'بھیجنا': 'send', 'سیٹنگ': 'settings', 'پاسورڈ': 'password', 'ای میل': 'email', 'ویب': 'website', 'نقشہ': 'map', 'مجھے': '', 'میں': '', 'کر': 'do', 'سکتا': 'can', 'سکتی': 'can', 'ہوں': '', 'ہے': '', 'ہیں': '', 'کو': '', 'کا': '', 'کی': '', 'کے': '', 'سے': '', 'پر': '', 'اور': '',
};

const norm = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const words = (s) => String(s || '').split(/\s+/).map(norm).filter(Boolean);

const ROMAN_MARKERS = new Set(['hai', 'hain', 'hy', 'hu', 'hun', 'kese', 'kaise', 'kasay', 'kesay', 'kaisay', 'kar', 'karna', 'karne', 'karo', 'karen', 'karein', 'krna', 'sakta', 'sakti', 'sakte', 'ssakta', 'me', 'mein', 'main', 'mujhe', 'aap', 'apna', 'apni', 'ka', 'ki', 'ke', 'ko', 'se', 'par', 'pe', 'ye', 'yeh', 'wo', 'woh', 'aur', 'nahi', 'nahin', 'kya', 'kia', 'kahan', 'kab', 'kyun', 'chahiye', 'liye', 'bata', 'batao', 'batain', 'wala', 'wali', 'jaye', 'jaen', 'jayega', 'hoga', 'hogi', 'hota', 'hoti', 'karen', 'dekhna', 'dalna', 'dalein', 'banana', 'banain', 'jata', 'jati', 'milega', 'milti', 'milta', 'lagana', 'tab', 'jab', 'phir', 'agar', 'lekin', 'bilkul', 'sirf', 'abhi', 'zaroor', 'zaroori', 'shukriya', 'kese']);
const URDU_RANGE = /[؀-ۿݐ-ݿ]/g;
const ENGLISH_COMMON = new Set(['the', 'and', 'to', 'of', 'in', 'is', 'you', 'your', 'open', 'click', 'then', 'with', 'for', 'select', 'press', 'menu', 'screen']);

/** 'en' | 'roman-urdu' | 'urdu' | 'arabic' | 'other' — a cheap guess at the language a question is written in. */
export function detectLanguage(text) {
  const s = String(text || '');
  const arabic = (s.match(URDU_RANGE) || []).length;
  const letters = (s.match(/\p{L}/gu) || []).length || 1;
  if (arabic / letters > 0.4) return /[ٹڈڑںھےگچپژ]/.test(s) || words(s).some((w) => RU[w] !== undefined) ? 'urdu' : 'arabic';
  if (/[ऀ-ॿ]/.test(s)) return 'hindi';
  if ((s.match(/[^\x00-\x7F]/g) || []).length / letters > 0.3) return 'other';
  const w = words(s);
  const hits = w.filter((x) => ROMAN_MARKERS.has(x)).length;
  const eng = w.filter((x) => ENGLISH_COMMON.has(x)).length;
  if (hits >= 2 && hits >= eng) return 'roman-urdu';
  if (hits >= 1 && w.length <= 4 && eng === 0 && w.some((x) => RU[x] === '')) return 'roman-urdu';
  return 'en';
}

/** Human name used in the prompt. */
export const languageName = (l) => ({ 'roman-urdu': 'Roman Urdu (Urdu written with English letters, as in "aap yahan se appointment add kar sakte hain")', urdu: 'Urdu (Urdu script)', arabic: 'Arabic', hindi: 'Hindi', other: 'the same language as the question', en: 'English' })[l] || 'the same language as the question';

/**
 * The question as English search words: known Roman Urdu / Urdu words are replaced by their English meaning, filler words are dropped,
 * unknown words are kept (product names, English words). Returns { query, translated } where translated is true when anything changed.
 */
export function englishSearchText(question) {
  const out = []; let translated = false;
  for (const w of words(question)) {
    if (w in RU) { translated = true; if (RU[w]) out.push(RU[w]); } else out.push(w);
  }
  return { query: out.join(' '), translated };
}

/** Does an answer look like it is written in the wanted language? (used to retry once when the engine answered in English) */
export function answerMatchesLanguage(lang, answer) {
  const a = String(answer || '');
  if (lang === 'urdu' || lang === 'arabic') return (a.match(URDU_RANGE) || []).length / ((a.match(/\p{L}/gu) || []).length || 1) > 0.3;
  if (lang === 'hindi') return /[ऀ-ॿ]/.test(a);
  if (lang === 'roman-urdu') { const w = words(a); return w.filter((x) => ROMAN_MARKERS.has(x)).length >= Math.min(3, Math.ceil(w.length / 12)); }
  return true;
}

/**
 * True when the question asks HOW to do something (English, Roman Urdu, Urdu, Hindi), not for numbers from the live data.
 * "how can I add leads" / "me kese leads add kar sakta hu" -> true; "how many leads this month" / "kitni leads hain" -> false.
 */
export function isHowTo(question) {
  const q = ` ${String(question || '').toLowerCase().replace(/[?!.,]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
  const data = /\b(how many|how much|kitn[eiy]|kitna|total|count|number of|list of|report|pdf|balance|summary|statistics|stats|dikha|dikhao|batao kitn|show me)\b|کتنے|کتنی|کتنا|دکھا/.test(q);
  if (data) return false;
  return /\b(how (do|can|to|should|would)|how i\b|ways? to|steps? to|where (do|can|to)|kese|kaise|kesay|kaisay|kis tarah|kis tarha|tareeqa|tarika|tariqa|sikha|samjha|guide me)\b|کیسے|طریقہ|کس طرح|कैसे|तरीका/.test(q);
}
