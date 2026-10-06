// موجّه بسيط يعتمد على # في الرابط (يشتغل على GitHub Pages وبدون خادم)
import { useEffect, useState } from 'react';

function parse() {
  const h = (location.hash || '#/').slice(1);
  const [path, qs] = h.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  return { path: path || '/', parts: (path || '/').split('/').filter(Boolean), query };
}

export function useRoute() {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => { setRoute(parse()); window.scrollTo({ top: 0 }); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function navigate(to) {
  if (location.hash === to) return;
  location.hash = to;
}
