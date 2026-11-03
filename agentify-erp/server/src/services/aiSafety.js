// A first line of defence for AI requests, applied before anything is sent to a model: refuses clearly harmful, illegal or deceptive
// requests with a plain message. The models have their own safety filters on top; this keeps obvious abuse from costing credits.
import { bad } from '../util.js';

const RULES = [
  [/\b(child|minor|underage|teen)\b.{0,40}\b(nude|naked|sexual|porn|explicit)\b|\b(nude|naked|sexual|porn|explicit)\b.{0,40}\b(child|minor|underage)\b/i, 'This request cannot be created.'],
  [/\b(make|build|create|assemble|synthesi[sz]e)\b.{0,30}\b(bomb|explosive|weapon|gun|nerve agent|bioweapon|ransomware|malware)\b/i, 'Requests about making weapons or harmful tools cannot be created.'],
  [/\b(counterfeit|forged?|fake)\b.{0,30}\b(passport|id card|cnic|licen[sc]e|degree|certificate|currency|banknote|title deed|stamp)\b/i, 'Forged documents and counterfeit goods cannot be created.'],
  [/\b(phishing|scam|fraud|ponzi|pyramid scheme)\b.{0,30}\b(message|email|post|page|ad|advert|campaign|template)\b|\b(trick|deceive|cheat)\b.{0,25}\b(buyers?|investors?|customers?|tenants?)\b/i, 'Content designed to deceive people or commit fraud cannot be created.'],
  [/\b(kill|attack|harm|hurt)\b.{0,25}\b(them|people|group|community|minority)\b|\b(hate|inciting violence|ethnic cleansing)\b/i, 'Content that promotes violence or hatred cannot be created.'],
  [/\b(deepfake|impersonat\w+)\b|\bfake (news|review|testimonial)s?\b/i, 'Impersonation, fake reviews and fake testimonials cannot be created.'],
  [/\b(sell|buy|traffick\w*|smuggl\w*)\b.{0,25}\b(drugs?|cocaine|heroin|meth|weapons?|humans?|organs?)\b/i, 'Content about illegal trade cannot be created.'],
  [/\b(suicide|self.?harm)\b.{0,30}\b(how to|method|ways?|instructions?)\b/i, 'This request cannot be created. If you or someone you know needs help, please contact a local support line.'],
];

/** Throws a plain-words refusal when the text asks for something clearly harmful or illegal. */
export function assertSafeRequest(...texts) {
  const t = texts.filter(Boolean).join(' \n ').slice(0, 6000);
  for (const [re, msg] of RULES) if (re.test(t)) throw bad(msg, { code: 'unsafe_request' });
}
