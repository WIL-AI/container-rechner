export interface ContainerType {
  id: string;
  name: string;
  // Internal dimensions in millimeters
  length: number;
  width: number;
  height: number;
  // Weight in kilograms
  tareWeight: number; // Empty weight
  maxPayload: number; // Max cargo weight
  // Capabilities
  isOpenTop: boolean;
}

export const CONTAINERS: ContainerType[] = [
  {
    id: '20ft',
    name: '20ft Standard',
    length: 5890,
    width: 2350,
    height: 2390,
    tareWeight: 2300,
    maxPayload: 28230,
    isOpenTop: false,
  },
  {
    id: '40ft',
    name: '40ft Standard',
    length: 12030,
    width: 2350,
    height: 2390,
    tareWeight: 3750,
    maxPayload: 26730,
    isOpenTop: false,
  },
  {
    id: '40ft-hc',
    name: '40ft High Cube',
    length: 12030,
    width: 2350,
    height: 2690,
    tareWeight: 3900,
    maxPayload: 28770,
    isOpenTop: false,
  },
  {
    id: '20ft-ot',
    name: '20ft Open Top',
    length: 5890,
    width: 2350,
    height: 2330,
    tareWeight: 2450,
    maxPayload: 28030,
    isOpenTop: true,
  },
  {
    id: '40ft-ot',
    name: '40ft Open Top',
    length: 12030,
    width: 2350,
    height: 2330,
    tareWeight: 4200,
    maxPayload: 26280,
    isOpenTop: true,
  },
  {
    id: '40ft-fr',
    name: '40ft Flat Rack',
    length: 12030,
    width: 2350,
    height: 1950,
    tareWeight: 5500,
    maxPayload: 40000,
    isOpenTop: true,
  }
];
