// HERE Flexible Polyline decoder
// Spec: https://github.com/heremaps/flexible-polyline

export interface LatLng {
  lat: number;
  lng: number;
}

const ENCODING_TABLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function decodeUnsignedVarInt(encoded: string, index: number): [number, number] {
  let result = 0;
  let shift = 0;
  let byteval: number;

  do {
    byteval = ENCODING_TABLE.indexOf(encoded[index++]);
    if (byteval < 0) throw new Error('Invalid character in flexible polyline');
    result |= (byteval & 0x1f) << shift;
    shift += 5;
  } while (byteval >= 0x20);

  return [result, index];
}

function decodeSignedValue(encoded: string, index: number, precision: number): [number, number] {
  let [value, newIndex] = decodeUnsignedVarInt(encoded, index);
  if (value & 1) {
    value = ~value;
  }
  value >>= 1;
  return [value / Math.pow(10, precision), newIndex];
}

export function decodePolyline(encoded: string): LatLng[] {
  if (!encoded || encoded.length < 2) return [];

  let index = 0;

  // Header
  const [headerVersion, i1] = decodeUnsignedVarInt(encoded, index);
  index = i1;
  if (headerVersion !== 1) throw new Error(`Unsupported flexible polyline version: ${headerVersion}`);

  const [headerInfo, i2] = decodeUnsignedVarInt(encoded, index);
  index = i2;

  const precision2d = headerInfo & 0xf;
  // const precision3d = (headerInfo >> 4) & 0xf; // unused
  // const type3d = (headerInfo >> 8) & 0xf;      // unused

  const result: LatLng[] = [];
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    const [dlat, i3] = decodeSignedValue(encoded, index, precision2d);
    index = i3;
    const [dlng, i4] = decodeSignedValue(encoded, index, precision2d);
    index = i4;

    lat += dlat;
    lng += dlng;
    result.push({ lat, lng });
  }

  return result;
}
