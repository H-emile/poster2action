/**
 * 地图链接：故意不用任何需要 Key 的 SDK。
 * 用「搜索型」链接，把场地名 + 地址原样丢给地图 App，让它自己找。
 * 代价是可能搜索到同名地点 —— 所以界面上让用户自己选用哪个地图，并显示实际搜索词。
 */
export interface MapLink {
  id: 'amap' | 'osm' | 'apple';
  name: string;
  hint: string;
  url: string;
}

export function mapQuery(venue: string, address: string): string {
  return [venue, address].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

export function mapLinks(venue: string, address: string): MapLink[] {
  const q = mapQuery(venue, address);
  if (!q) return [];
  const enc = encodeURIComponent(q);
  return [
    { id: 'amap', name: '高德地图', hint: '国内定位最准', url: `https://uri.amap.com/search?keyword=${enc}` },
    { id: 'osm', name: 'OpenStreetMap', hint: '不用登录', url: `https://www.openstreetmap.org/search?query=${enc}` },
    { id: 'apple', name: 'Apple 地图', hint: 'iPhone 上直接打开', url: `https://maps.apple.com/?q=${enc}` },
  ];
}
