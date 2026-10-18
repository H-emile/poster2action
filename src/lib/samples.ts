import { derive } from './derive';
import { FIXTURES, docFromFixture, fixtureIds } from './extract';

export interface SampleCard {
  id: string;
  title: string;
  style: string;
  posterUrl: string;
  posterW: number;
  posterH: number;
  errors: number;
  warns: number;
  whenShort: string;
  filled: number;
  traced: number;
}

export function sampleCards(): SampleCard[] {
  return fixtureIds().map((id) => {
    const fx = FIXTURES[id];
    const doc = docFromFixture(id);
    const m = derive(doc);
    return {
      id,
      title: fx.meta.title,
      style: fx.meta.style,
      posterUrl: fx.posterUrl,
      posterW: fx.meta.width,
      posterH: fx.meta.height,
      errors: m.errors,
      warns: m.warns,
      whenShort: m.whenShort,
      filled: m.filled,
      traced: m.traced,
    };
  });
}
