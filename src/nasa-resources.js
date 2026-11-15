export const NASA_CHALLENGE_RESOURCES = Object.freeze([
  Object.freeze({
    id: 'nasa-hazards',
    title: '5 Hazards of Human Spaceflight',
    url: 'https://www.nasa.gov/hrp/hazards/',
    summary: 'NASA groups long-duration human-spaceflight hazards into radiation, isolation and confinement, distance from Earth, altered gravity, and hostile or closed environments.',
    usedFor: 'Frames the mission context and explains why astronauts need simple, repeatable self-monitoring during long missions.',
  }),
  Object.freeze({
    id: 'nasa-hrp-risks',
    title: 'Risks of Human Spaceflight',
    url: 'https://www.nasa.gov/hrp/risks/',
    summary: 'NASA’s Human Research Program describes health and performance risks associated with living and working in space.',
    usedFor: 'Organizes the project into separate body-movement, cognitive-task, and evidence-quality observations without turning them into a diagnosis.',
  }),
  Object.freeze({
    id: 'nasa-hrp-research',
    title: 'Ongoing HRP Research in Space',
    url: 'https://www.nasa.gov/hrp/ongoing-hrp-research/',
    summary: 'NASA documents ongoing Human Research Program investigations into how spaceflight affects human health and performance.',
    usedFor: 'Supports longitudinal reports that repeat the same observations over time and clearly show the limits of the available evidence.',
  }),
]);

const cleanText = value => typeof value === 'string' ? value.trim() : '';

function sanitizeSource(source) {
  const known = NASA_CHALLENGE_RESOURCES.find(item => item.id === source?.id);
  if (!known) return null;
  const url = cleanText(source.url);
  if (url !== known.url) return null;
  return {
    id: known.id,
    title: cleanText(source.title) || known.title,
    url: known.url,
    summary: cleanText(source.summary) || known.summary,
    usedFor: cleanText(source.usedFor) || known.usedFor,
  };
}

export async function loadNasaReference(fetcher = globalThis.fetch) {
  try {
    if (typeof fetcher !== 'function') throw new Error('Fetch is unavailable');
    const response = await fetcher('/data/nasa-reference.json');
    if (!response?.ok) throw new Error(`NASA reference returned ${response?.status || 'an error'}`);
    const data = await response.json();
    const sources = Array.isArray(data?.sources) ? data.sources.map(sanitizeSource).filter(Boolean) : [];
    if (sources.length !== NASA_CHALLENGE_RESOURCES.length) throw new Error('NASA challenge resources are incomplete');
    sources.sort((a, b) => NASA_CHALLENGE_RESOURCES.findIndex(item => item.id === a.id) - NASA_CHALLENGE_RESOURCES.findIndex(item => item.id === b.id));
    return {
      title: cleanText(data.title) || 'NASA research basis',
      challenge: cleanText(data.challenge) || 'Create Health Monitoring Software for Astronauts on Space Missions',
      sources,
      fallback: false,
    };
  } catch {
    return {
      title: 'NASA research basis',
      challenge: 'Create Health Monitoring Software for Astronauts on Space Missions',
      sources: NASA_CHALLENGE_RESOURCES.map(source => ({ ...source })),
      fallback: true,
    };
  }
}
