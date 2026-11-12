// Support desk: the lists, service-level targets and every piece of text the help desk shows, in English and in each
// region's own language. Shared by the workspace page, the console page and the server (e-mails), so a word is
// changed in one place. Native text is machine-drafted and listed in docs/support-desk.md for a native reviewer.
export const STATUSES = ['open', 'pending', 'solved', 'closed'];
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
export const CATEGORIES = ['question', 'problem', 'billing', 'account', 'feature', 'other'];
export const LANGS = ['en', 'ur', 'ar', 'fr'];
export const LANG_NAMES = { en: 'English', ur: 'اردو', ar: 'العربية', fr: 'Français' };
/** Each country's own language for the help desk (English is always offered too). */
export const NATIVE_LANG = { PK: 'ur', AE: 'ar', CA: 'fr', UK: 'en', US: 'en' };
export const RTL_LANGS = ['ur', 'ar'];
export const nativeLang = (region) => NATIVE_LANG[String(region || '').toUpperCase()] || 'en';
/** The languages a workspace in this region can write in: English first, then its own language. */
export const supportLangs = (region) => [...new Set(['en', nativeLang(region)])];
export const langDir = (lang) => (RTL_LANGS.includes(lang) ? 'rtl' : 'ltr');

/** Default targets in minutes: [first reply, solved]. The console can change them. Measured in plain clock time. */
export const DEFAULT_SLA = { urgent: [60, 480], high: [240, 1440], normal: [480, 2880], low: [1440, 7200] };
export const ATTACH_LIMITS = { files: 3, bytes: 450 * 1024, types: ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'] };

const EN = {
  title: 'Help & Support', sub: 'Ask our support team a question or report a problem. We reply here and by e-mail.',
  new: 'New ticket', mine: 'My tickets', workspace: 'Workspace tickets', all: 'All', number: 'No.', requester: 'From', updated: 'Last update',
  subject: 'Subject', category: 'Category', priority: 'Priority', message: 'Message', message_hint: 'Tell us what happened, what you were doing and which page you were on.',
  attach: 'Attach files', attach_hint: 'Up to 3 files, images or PDF, 450 KB each.', download: 'Download',
  send: 'Send ticket', sending: 'Sending…', cancel: 'Cancel', back: 'Back', reply_ph: 'Write your reply…', reply_send: 'Send reply',
  mark_solved: 'Mark as solved', reopen: 'Reopen', empty_title: 'No tickets yet', empty_hint: 'Have a question or a problem? Press New ticket.',
  created: 'Ticket {no} sent. We will e-mail you when we reply.', reply_by: 'First reply by {when}', you: 'You', team: 'Agentify support',
  secure: 'Your message travels over a secure (HTTPS) connection and is seen only by you and the Agentify support team.',
  lang: 'Language', file_big: 'That file is too large (450 KB at most).', file_type: 'Only images (PNG, JPG, WebP) and PDF files can be attached.', file_many: 'You can attach up to 3 files.',
  'st.open': 'Open', 'st.pending': 'Waiting for your reply', 'st.solved': 'Solved', 'st.closed': 'Closed',
  'pri.low': 'Low', 'pri.normal': 'Normal', 'pri.high': 'High', 'pri.urgent': 'Urgent', 'pri.urgent_hint': 'Choose Urgent only if your work has stopped.',
  'cat.question': 'Question / how do I…', 'cat.problem': 'Problem or error', 'cat.billing': 'Billing and payment', 'cat.account': 'Account and sign-in', 'cat.feature': 'Feature request', 'cat.other': 'Other',
  // e-mails
  'mail.new_subject': 'Ticket {no} received: {subject}', 'mail.new_heading': 'We received your request',
  'mail.new_l1': 'Your ticket {no} is open: {subject}', 'mail.new_l2': 'We aim to reply by {when}.', 'mail.new_l3': 'You can add details or files any time from Help & Support in your workspace.',
  'mail.reply_subject': 'New reply on ticket {no}: {subject}', 'mail.reply_heading': 'Agentify support replied', 'mail.reply_l1': 'Ticket {no}: {subject}',
  'mail.solved_subject': 'Ticket {no} is marked as solved', 'mail.solved_heading': 'Your ticket is solved',
  'mail.solved_l1': 'We marked ticket {no} ({subject}) as solved. If it is not fixed, reply from Help & Support and we will reopen it.', 'mail.open': 'Open ticket',
};
const UR = {
  title: 'مدد اور سپورٹ', sub: 'ہماری سپورٹ ٹیم سے سوال پوچھیں یا مسئلہ بتائیں۔ ہم یہیں اور ای میل پر جواب دیں گے۔',
  new: 'نیا ٹکٹ', mine: 'میرے ٹکٹ', workspace: 'ورک اسپیس کے ٹکٹ', all: 'سب', number: 'نمبر', requester: 'بھیجنے والا', updated: 'آخری تبدیلی',
  subject: 'موضوع', category: 'زمرہ', priority: 'ترجیح', message: 'پیغام', message_hint: 'بتائیں کیا ہوا، آپ کیا کر رہے تھے اور کون سے صفحے پر تھے۔',
  attach: 'فائلیں لگائیں', attach_hint: 'زیادہ سے زیادہ 3 فائلیں، تصویر یا PDF، ہر ایک 450 KB تک۔', download: 'ڈاؤن لوڈ',
  send: 'ٹکٹ بھیجیں', sending: 'بھیجا جا رہا ہے…', cancel: 'منسوخ کریں', back: 'واپس', reply_ph: 'اپنا جواب لکھیں…', reply_send: 'جواب بھیجیں',
  mark_solved: 'حل شدہ کا نشان لگائیں', reopen: 'دوبارہ کھولیں', empty_title: 'ابھی کوئی ٹکٹ نہیں', empty_hint: 'کوئی سوال یا مسئلہ ہے؟ "نیا ٹکٹ" دبائیں۔',
  created: 'ٹکٹ {no} بھیج دیا گیا۔ جواب آنے پر ہم آپ کو ای میل کریں گے۔', reply_by: 'پہلا جواب {when} تک', you: 'آپ', team: 'Agentify سپورٹ',
  secure: 'آپ کا پیغام محفوظ (HTTPS) کنکشن پر جاتا ہے اور صرف آپ اور Agentify سپورٹ ٹیم دیکھ سکتی ہے۔',
  lang: 'زبان', file_big: 'یہ فائل بہت بڑی ہے (زیادہ سے زیادہ 450 KB)۔', file_type: 'صرف تصویر (PNG، JPG، WebP) اور PDF فائلیں لگائی جا سکتی ہیں۔', file_many: 'آپ زیادہ سے زیادہ 3 فائلیں لگا سکتے ہیں۔',
  'st.open': 'کھلا', 'st.pending': 'آپ کے جواب کا منتظر', 'st.solved': 'حل ہو گیا', 'st.closed': 'بند',
  'pri.low': 'کم', 'pri.normal': 'عام', 'pri.high': 'زیادہ', 'pri.urgent': 'فوری', 'pri.urgent_hint': 'فوری صرف تب چنیں جب آپ کا کام رک گیا ہو۔',
  'cat.question': 'سوال / کیسے کروں…', 'cat.problem': 'مسئلہ یا خرابی', 'cat.billing': 'بلنگ اور ادائیگی', 'cat.account': 'اکاؤنٹ اور لاگ اِن', 'cat.feature': 'نئی خصوصیت کی درخواست', 'cat.other': 'دیگر',
  'mail.new_subject': 'ٹکٹ {no} موصول ہو گیا: {subject}', 'mail.new_heading': 'ہمیں آپ کی درخواست مل گئی',
  'mail.new_l1': 'آپ کا ٹکٹ {no} کھلا ہے: {subject}', 'mail.new_l2': 'ہم {when} تک جواب دینے کی کوشش کریں گے۔', 'mail.new_l3': 'آپ اپنی ورک اسپیس میں "مدد اور سپورٹ" سے کسی بھی وقت مزید تفصیل یا فائلیں شامل کر سکتے ہیں۔',
  'mail.reply_subject': 'ٹکٹ {no} پر نیا جواب: {subject}', 'mail.reply_heading': 'Agentify سپورٹ نے جواب دیا', 'mail.reply_l1': 'ٹکٹ {no}: {subject}',
  'mail.solved_subject': 'ٹکٹ {no} حل شدہ ہے', 'mail.solved_heading': 'آپ کا ٹکٹ حل ہو گیا',
  'mail.solved_l1': 'ہم نے ٹکٹ {no} ({subject}) حل شدہ کر دیا ہے۔ اگر مسئلہ باقی ہے تو "مدد اور سپورٹ" سے جواب دیں، ہم اسے دوبارہ کھول دیں گے۔', 'mail.open': 'ٹکٹ کھولیں',
};
const AR = {
  title: 'المساعدة والدعم', sub: 'اسأل فريق الدعم لدينا أو أبلغ عن مشكلة. سنرد هنا وعبر البريد الإلكتروني.',
  new: 'تذكرة جديدة', mine: 'تذاكري', workspace: 'تذاكر مساحة العمل', all: 'الكل', number: 'الرقم', requester: 'المرسل', updated: 'آخر تحديث',
  subject: 'الموضوع', category: 'الفئة', priority: 'الأولوية', message: 'الرسالة', message_hint: 'اشرح ما حدث، وماذا كنت تفعل، وفي أي صفحة كنت.',
  attach: 'إرفاق ملفات', attach_hint: 'حتى 3 ملفات، صور أو PDF، بحد أقصى 450 كيلوبايت لكل ملف.', download: 'تنزيل',
  send: 'إرسال التذكرة', sending: 'جارٍ الإرسال…', cancel: 'إلغاء', back: 'رجوع', reply_ph: 'اكتب ردك…', reply_send: 'إرسال الرد',
  mark_solved: 'تحديد كـ «تم الحل»', reopen: 'إعادة الفتح', empty_title: 'لا توجد تذاكر بعد', empty_hint: 'لديك سؤال أو مشكلة؟ اضغط «تذكرة جديدة».',
  created: 'تم إرسال التذكرة {no}. سنراسلك عبر البريد الإلكتروني عند الرد.', reply_by: 'أول رد قبل {when}', you: 'أنت', team: 'دعم Agentify',
  secure: 'تنتقل رسالتك عبر اتصال آمن (HTTPS) ولا يراها إلا أنت وفريق دعم Agentify.',
  lang: 'اللغة', file_big: 'هذا الملف كبير جدًا (الحد الأقصى 450 كيلوبايت).', file_type: 'يمكن إرفاق الصور (PNG وJPG وWebP) وملفات PDF فقط.', file_many: 'يمكنك إرفاق 3 ملفات كحد أقصى.',
  'st.open': 'مفتوحة', 'st.pending': 'بانتظار ردك', 'st.solved': 'تم الحل', 'st.closed': 'مغلقة',
  'pri.low': 'منخفضة', 'pri.normal': 'عادية', 'pri.high': 'عالية', 'pri.urgent': 'عاجلة', 'pri.urgent_hint': 'اختر «عاجلة» فقط إذا توقف عملك.',
  'cat.question': 'سؤال / كيف أفعل…', 'cat.problem': 'مشكلة أو خطأ', 'cat.billing': 'الفواتير والدفع', 'cat.account': 'الحساب وتسجيل الدخول', 'cat.feature': 'طلب ميزة', 'cat.other': 'أخرى',
  'mail.new_subject': 'تم استلام التذكرة {no}: {subject}', 'mail.new_heading': 'استلمنا طلبك',
  'mail.new_l1': 'تذكرتك {no} مفتوحة: {subject}', 'mail.new_l2': 'نهدف إلى الرد قبل {when}.', 'mail.new_l3': 'يمكنك إضافة تفاصيل أو ملفات في أي وقت من «المساعدة والدعم» في مساحة عملك.',
  'mail.reply_subject': 'رد جديد على التذكرة {no}: {subject}', 'mail.reply_heading': 'ردّ دعم Agentify', 'mail.reply_l1': 'التذكرة {no}: {subject}',
  'mail.solved_subject': 'تم حل التذكرة {no}', 'mail.solved_heading': 'تم حل تذكرتك',
  'mail.solved_l1': 'وضعنا علامة «تم الحل» على التذكرة {no} ({subject}). إذا لم تُحل المشكلة فرُدّ من «المساعدة والدعم» وسنعيد فتحها.', 'mail.open': 'فتح التذكرة',
};
const FR = {
  title: 'Aide et assistance', sub: "Posez une question à notre équipe d'assistance ou signalez un problème. Nous répondons ici et par e-mail.",
  new: 'Nouveau ticket', mine: 'Mes tickets', workspace: "Tickets de l'espace de travail", all: 'Tous', number: 'N°', requester: 'Demandeur', updated: 'Dernière mise à jour',
  subject: 'Objet', category: 'Catégorie', priority: 'Priorité', message: 'Message', message_hint: "Expliquez ce qui s'est passé, ce que vous faisiez et sur quelle page vous étiez.",
  attach: 'Joindre des fichiers', attach_hint: '3 fichiers au maximum, images ou PDF, 450 Ko chacun.', download: 'Télécharger',
  send: 'Envoyer le ticket', sending: 'Envoi…', cancel: 'Annuler', back: 'Retour', reply_ph: 'Écrivez votre réponse…', reply_send: 'Envoyer la réponse',
  mark_solved: 'Marquer comme résolu', reopen: 'Rouvrir', empty_title: 'Aucun ticket pour le moment', empty_hint: 'Une question ou un problème ? Appuyez sur « Nouveau ticket ».',
  created: 'Ticket {no} envoyé. Nous vous écrirons par e-mail dès que nous aurons répondu.', reply_by: 'Première réponse avant {when}', you: 'Vous', team: 'Assistance Agentify',
  secure: "Votre message circule sur une connexion sécurisée (HTTPS) et n'est visible que de vous et de l'équipe d'assistance Agentify.",
  lang: 'Langue', file_big: 'Ce fichier est trop volumineux (450 Ko au maximum).', file_type: 'Seules les images (PNG, JPG, WebP) et les fichiers PDF peuvent être joints.', file_many: 'Vous pouvez joindre 3 fichiers au maximum.',
  'st.open': 'Ouvert', 'st.pending': 'En attente de votre réponse', 'st.solved': 'Résolu', 'st.closed': 'Fermé',
  'pri.low': 'Basse', 'pri.normal': 'Normale', 'pri.high': 'Haute', 'pri.urgent': 'Urgente', 'pri.urgent_hint': 'Choisissez « Urgente » seulement si votre travail est bloqué.',
  'cat.question': 'Question / comment faire…', 'cat.problem': 'Problème ou erreur', 'cat.billing': 'Facturation et paiement', 'cat.account': 'Compte et connexion', 'cat.feature': 'Demande de fonctionnalité', 'cat.other': 'Autre',
  'mail.new_subject': 'Ticket {no} reçu : {subject}', 'mail.new_heading': 'Nous avons reçu votre demande',
  'mail.new_l1': 'Votre ticket {no} est ouvert : {subject}', 'mail.new_l2': 'Nous visons une première réponse avant {when}.', 'mail.new_l3': "Vous pouvez ajouter des précisions ou des fichiers à tout moment depuis « Aide et assistance » dans votre espace de travail.",
  'mail.reply_subject': 'Nouvelle réponse au ticket {no} : {subject}', 'mail.reply_heading': "L'assistance Agentify a répondu", 'mail.reply_l1': 'Ticket {no} : {subject}',
  'mail.solved_subject': 'Le ticket {no} est résolu', 'mail.solved_heading': 'Votre ticket est résolu',
  'mail.solved_l1': "Nous avons marqué le ticket {no} ({subject}) comme résolu. Si le problème persiste, répondez depuis « Aide et assistance » et nous le rouvrirons.", 'mail.open': 'Ouvrir le ticket',
};
export const SUPPORT_TEXT = { en: EN, ur: UR, ar: AR, fr: FR };

const fill = (s, p) => String(s).replace(/\{(\w+)\}/g, (m, k) => (p && p[k] !== undefined ? String(p[k]) : m));
/** Text in a language, falling back to English. */
export const st = (lang, key, params) => fill((SUPPORT_TEXT[lang] || EN)[key] ?? EN[key] ?? key, params);
export const ticketNo = (id) => `T-${1000 + Number(id)}`;
