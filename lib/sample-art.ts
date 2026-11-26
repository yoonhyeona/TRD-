export const sampleIds = ["seaside", "garden", "table"] as const;
export type SampleId = (typeof sampleIds)[number];

export const sampleLabels: Record<SampleId, string> = {
  seaside: "바닷가 풍경",
  garden: "꽃이 핀 정원",
  table: "따뜻한 식탁",
};

const colors: Record<SampleId, [string, string, string]> = {
  seaside: ["#cfe8f3", "#78b8c2", "#718b8e"],
  garden: ["#d9ecf2", "#91aa71", "#d97767"],
  table: ["#d7e5d7", "#b98057", "#87b5c3"],
};

export function sampleSvg(id: SampleId): string {
  const [sky, ground, accent] = colors[id];
  const scene =
    id === "seaside"
      ? `<circle cx="640" cy="105" r="52" fill="#f3c96b"/><path d="M0 260 180 145 350 260 520 130 800 260V500H0Z" fill="${ground}"/><path d="M0 365q100-30 200 0t200 0 200 0 200 0" fill="none" stroke="#e8f4eb" stroke-width="8"/>`
      : id === "garden"
        ? `<path d="M0 330H800V500H0Z" fill="${ground}"/><g stroke="#55734e" stroke-width="9">${[160, 300, 450, 610, 710].map((x) => `<path d="M${x} 300v170"/>`).join("")}</g><g fill="${accent}">${[160, 300, 450, 610, 710].map((x, i) => `<circle cx="${x}" cy="${i % 2 ? 300 : 240}" r="34"/>`).join("")}</g>`
        : `<path d="M0 330H800V500H0Z" fill="${ground}"/><rect x="90" y="270" width="620" height="100" rx="35" fill="#f3e7d4"/><ellipse cx="400" cy="320" rx="150" ry="38" fill="#88a86f"/><circle cx="350" cy="315" r="16" fill="#e3c56d"/><circle cx="405" cy="330" r="16" fill="#d97f63"/><circle cx="460" cy="310" r="16" fill="#e7d7a4"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500"><rect width="800" height="500" fill="${sky}"/>${scene}</svg>`;
}
