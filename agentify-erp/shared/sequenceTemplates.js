// Ready-made follow-up sequences. Every one is a starting point the workspace edits: the wording, delays, sending window and
// consent category are theirs to change. Variables: {{first_name}} {{full_name}} {{agent_name}} {{company}} {{property}} {{project}}.
// French and Arabic drafts are machine-prepared and need a native review before a business relies on them.
// Marketing-category steps are only sent to people with recorded marketing consent; operational steps answer an enquiry or visit.

const STOP = { reply: true, appointment_booked: true, lead_closed: true };
const WINDOW = { start: '09:00', end: '18:00', working_days_only: true };
const FREQ = { max_per_week: 3, min_gap_hours: 24 };

const TEXT = {
  en: {
    inquiry: {
      name: 'New property inquiry',
      s1: ['Thanks for your enquiry, {{first_name}}', 'Hello {{first_name}},\n\nThank you for asking about {{property}}. {{agent_name}} from {{company}} will be in touch to help you. If you would like to see it, just reply to this email with a day and time that suit you.\n\nKind regards,\n{{agent_name}}'],
      t1: 'Call {{full_name}} about their enquiry',
      s2: ['Still interested in {{property}}?', 'Hello {{first_name}},\n\nI wanted to check whether you still have questions about {{property}}. I can share more details, photos or arrange a viewing, whichever helps.\n\nKind regards,\n{{agent_name}}'],
    },
    viewing: {
      name: 'Viewing follow-up',
      s1: ['Thank you for visiting {{property}}', 'Hello {{first_name}},\n\nThank you for taking the time to view {{property}} with us. If you have questions or would like to see other options, reply to this email and I will help.\n\nKind regards,\n{{agent_name}}'],
      t1: 'Ask {{full_name}} for feedback after the viewing',
      s2: ['Any thoughts on {{property}}?', 'Hello {{first_name}},\n\nDid you have a chance to think about {{property}}? I am happy to answer questions or arrange a second visit.\n\nKind regards,\n{{agent_name}}'],
    },
    nurture: {
      name: 'Long-term nurture',
      s1: ['Staying in touch, {{first_name}}', 'Hello {{first_name}},\n\nWe will keep you in mind as new listings arrive that match what you told us. If your plans change, reply to this email any time.\n\nKind regards,\n{{agent_name}}'],
      t1: 'Check in with {{full_name}}',
      s2: ['New options you may like', 'Hello {{first_name}},\n\nSince we last spoke, new properties may suit you. Reply with your budget and preferred area and I will send a short list.\n\nKind regards,\n{{agent_name}}'],
    },
  },
  fr: {
    inquiry: {
      name: 'Nouvelle demande de bien',
      s1: ['Merci pour votre demande, {{first_name}}', 'Bonjour {{first_name}},\n\nMerci de votre intérêt pour {{property}}. {{agent_name}}, de {{company}}, va vous contacter. Pour une visite, répondez simplement à ce message avec le jour et l’heure qui vous conviennent.\n\nCordialement,\n{{agent_name}}'],
      t1: 'Appeler {{full_name}} au sujet de sa demande',
      s2: ['Toujours intéressé par {{property}} ?', 'Bonjour {{first_name}},\n\nAvez-vous encore des questions sur {{property}} ? Je peux vous envoyer plus de détails ou organiser une visite.\n\nCordialement,\n{{agent_name}}'],
    },
    viewing: {
      name: 'Suivi après visite',
      s1: ['Merci de votre visite de {{property}}', 'Bonjour {{first_name}},\n\nMerci d’avoir pris le temps de visiter {{property}}. Pour toute question ou d’autres options, répondez à ce message.\n\nCordialement,\n{{agent_name}}'],
      t1: 'Demander son avis à {{full_name}} après la visite',
      s2: ['Votre avis sur {{property}} ?', 'Bonjour {{first_name}},\n\nAvez-vous pu réfléchir à {{property}} ? Je réponds volontiers à vos questions ou organise une seconde visite.\n\nCordialement,\n{{agent_name}}'],
    },
    nurture: {
      name: 'Suivi à long terme',
      s1: ['Nous restons en contact, {{first_name}}', 'Bonjour {{first_name}},\n\nNous pensons à vous dès que de nouveaux biens correspondent à votre recherche. Si vos projets changent, répondez à ce message.\n\nCordialement,\n{{agent_name}}'],
      t1: 'Reprendre contact avec {{full_name}}',
      s2: ['De nouvelles options pour vous', 'Bonjour {{first_name}},\n\nDe nouveaux biens pourraient vous convenir. Indiquez-moi votre budget et le quartier souhaité et je vous envoie une sélection.\n\nCordialement,\n{{agent_name}}'],
    },
  },
  ar: {
    inquiry: {
      name: 'استفسار جديد عن عقار',
      s1: ['شكراً لاستفسارك، {{first_name}}', 'مرحباً {{first_name}}،\n\nشكراً لاهتمامك بـ {{property}}. سيتواصل معك {{agent_name}} من {{company}}. إن رغبت بمعاينة العقار فرُدّ على هذه الرسالة بالموعد المناسب لك.\n\nمع التحية،\n{{agent_name}}'],
      t1: 'الاتصال بـ {{full_name}} بخصوص استفساره',
      s2: ['هل ما زلت مهتماً بـ {{property}}؟', 'مرحباً {{first_name}}،\n\nهل لديك أسئلة أخرى حول {{property}}؟ يسعدني إرسال المزيد من التفاصيل أو ترتيب معاينة.\n\nمع التحية،\n{{agent_name}}'],
    },
    viewing: {
      name: 'متابعة بعد المعاينة',
      s1: ['شكراً لزيارتك {{property}}', 'مرحباً {{first_name}}،\n\nشكراً لوقتك في معاينة {{property}}. إن كانت لديك أسئلة أو ترغب في خيارات أخرى فرُدّ على هذه الرسالة.\n\nمع التحية،\n{{agent_name}}'],
      t1: 'طلب رأي {{full_name}} بعد المعاينة',
      s2: ['ما رأيك في {{property}}؟', 'مرحباً {{first_name}}،\n\nهل فكرت في {{property}}؟ يسعدني الإجابة عن أسئلتك أو ترتيب زيارة ثانية.\n\nمع التحية،\n{{agent_name}}'],
    },
    nurture: {
      name: 'متابعة طويلة المدى',
      s1: ['نبقى على تواصل، {{first_name}}', 'مرحباً {{first_name}}،\n\nسنتذكرك عند توفر عقارات جديدة تناسب طلبك. وإن تغيرت خططك فرُدّ على هذه الرسالة في أي وقت.\n\nمع التحية،\n{{agent_name}}'],
      t1: 'التواصل مع {{full_name}}',
      s2: ['خيارات جديدة قد تناسبك', 'مرحباً {{first_name}}،\n\nقد تناسبك عقارات جديدة. أخبرني بميزانيتك والمنطقة المفضلة وأرسل لك قائمة مختصرة.\n\nمع التحية،\n{{agent_name}}'],
    },
  },
};

const DAY = 1440;
const build = (t, trigger, kind, steps) => ({ trigger, kind, config: { steps, window: { ...WINDOW }, frequency: { ...FREQ }, stop_on: { ...STOP } } });

/** The templates in a language (en, fr, ar). `regions` says where the wording is usually used; all are editable. */
export function sequenceTemplates(lang = 'en') {
  const t = TEXT[lang] || TEXT.en;
  const L = TEXT[lang] ? lang : 'en';
  const mk = (id, trigger, steps) => ({ id, language: L, name: t[id].name, needs_review: L !== 'en', ...build(t, trigger, id, steps) });
  const mail = (s, delay, category) => ({ type: 'email', delay_minutes: delay, category, subject: s[0], body: s[1], condition: 'no_reply' });
  return [
    mk('inquiry', { type: 'new_inquiry' }, [mail(t.inquiry.s1, 0, 'operational'), { type: 'task', delay_minutes: 60, title: t.inquiry.t1, due_in_days: 0, condition: 'no_human_response' }, mail(t.inquiry.s2, 3 * DAY, 'operational')]),
    mk('viewing', { type: 'viewing_completed' }, [mail(t.viewing.s1, 60, 'operational'), { type: 'task', delay_minutes: DAY, title: t.viewing.t1, due_in_days: 0, condition: 'always' }, mail(t.viewing.s2, 4 * DAY, 'operational')]),
    mk('nurture', { type: 'manual' }, [mail(t.nurture.s1, 0, 'marketing'), { type: 'task', delay_minutes: 14 * DAY, title: t.nurture.t1, due_in_days: 0, condition: 'no_human_response' }, mail(t.nurture.s2, 30 * DAY, 'marketing')]),
  ];
}
export const TEMPLATE_LANGUAGES = Object.keys(TEXT);
