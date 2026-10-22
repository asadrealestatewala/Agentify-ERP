// The public home page: CRM first, then the ERP behind it. Sections live in this folder; product previews use sample data
// from sample.js; market headlines come from the server (regions/marketingCopy.js) through useCountry().
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useCountry, useTitle } from '../core.jsx';
import Hero from './Hero.jsx';
import Tour from './Tour.jsx';
import { CustomerStories, FAQ, Features, FinalCTA, Integrations, LogoMarquee, MobileShowcase, PricingPreview, Workflow } from './Sections.jsx';
import './home.css';

/** Menu links point at /#section; scroll there once the page has rendered (instantly when motion is reduced). */
function useHashScroll() {
  const loc = useLocation();
  useEffect(() => {
    if (!loc.hash) return undefined;
    const id = loc.hash.slice(1);
    const t = setTimeout(() => {
      const el = document.getElementById(id === 'pipeline' || id === 'crm' ? 'tour' : id);
      if (!el) return;
      const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
    }, 60);
    return () => clearTimeout(t);
  }, [loc.hash, loc.key]);
}

export default function Home({ info }) {
  const c = info.content;
  const { country } = useCountry();
  const cc = country.copy || {};
  useTitle(c.seo.home.title, c.seo.home.description);
  useHashScroll();
  const testimonials = c.testimonials || []; // every approved story, labelled with the customer's own country
  return (
    <div className="h-page">
      <Hero trialDays={info.trial_days} />
      <LogoMarquee />
      <Tour />
      <Workflow />
      <Features />
      <MobileShowcase />
      <Integrations />
      <CustomerStories testimonials={testimonials} trialDays={info.trial_days} />
      <PricingPreview info={info} />
      <FAQ faqs={[...(c.faqs || []), ...(cc.faqs || [])]} />
      <FinalCTA trialDays={info.trial_days} />
    </div>
  );
}
