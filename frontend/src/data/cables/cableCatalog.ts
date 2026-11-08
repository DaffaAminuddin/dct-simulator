/**
 * Cable and transceiver catalog. Speeds and reaches follow common industry
 * practice for each media type; exact limits vary by vendor (see
 * docs/ASSUMPTIONS.md).
 */
import type { CableModel, TransceiverModel } from '@/types/catalog';

export const CABLE_MODELS: Record<string, CableModel> = {};
function add(c: CableModel) {
  CABLE_MODELS[c.id] = c;
}

// Copper Ethernet
add({ id: 'cat6-2m', name: 'Cat6 Ethernet patch cable, 2 m', shortName: 'Cat6 2m', media: 'copper', ends: ['rj45', 'rj45'], speedsGbps: [10, 1, 0.1], lengthM: 2, color: '#3b82f6', accuracy: 'industry', note: 'Cat6 supports 10GBASE-T up to about 55 m.' });
add({ id: 'cat6a-3m', name: 'Cat6A Ethernet patch cable, 3 m', shortName: 'Cat6A 3m', media: 'copper', ends: ['rj45', 'rj45'], speedsGbps: [10, 1, 0.1], lengthM: 3, color: '#8b5cf6', accuracy: 'industry', note: 'Cat6A supports 10GBASE-T up to 100 m.' });
add({ id: 'mgmt-rj45-1m', name: 'RJ45 management patch cable, 1 m', shortName: 'Mgmt RJ45 1m', media: 'copper', ends: ['rj45', 'rj45'], speedsGbps: [1, 0.1], lengthM: 1, color: '#eab308', accuracy: 'industry', note: 'Colour-coded short patch lead for the out-of-band management network.' });
add({ id: 'mgmt-rj45-3m', name: 'RJ45 management patch cable, 3 m', shortName: 'Mgmt RJ45 3m', media: 'copper', ends: ['rj45', 'rj45'], speedsGbps: [1, 0.1], lengthM: 3, color: '#eab308', accuracy: 'industry' });

// Direct-attach copper and active optical
add({ id: 'dac-sfpp-1m', name: 'SFP+ passive DAC, 10G, 1 m', shortName: 'SFP+ DAC 1m', media: 'dac', ends: ['sfp_plus', 'sfp_plus'], speedsGbps: [10], lengthM: 1, color: '#111827', accuracy: 'industry' });
add({ id: 'dac-sfp28-1m', name: 'SFP28 passive DAC, 25G, 1 m', shortName: 'SFP28 DAC 1m', media: 'dac', ends: ['sfp28', 'sfp28'], speedsGbps: [25, 10], lengthM: 1, color: '#111827', accuracy: 'industry' });
add({ id: 'dac-sfp28-2m', name: 'SFP28 passive DAC, 25G, 2 m', shortName: 'SFP28 DAC 2m', media: 'dac', ends: ['sfp28', 'sfp28'], speedsGbps: [25, 10], lengthM: 2, color: '#111827', accuracy: 'industry' });
add({ id: 'dac-sfp28-3m', name: 'SFP28 passive DAC, 25G, 3 m', shortName: 'SFP28 DAC 3m', media: 'dac', ends: ['sfp28', 'sfp28'], speedsGbps: [25, 10], lengthM: 3, color: '#111827', accuracy: 'industry' });
add({ id: 'dac-qsfp28-2m', name: 'QSFP28 passive DAC, 100G, 2 m', shortName: 'QSFP28 DAC 2m', media: 'dac', ends: ['qsfp28', 'qsfp28'], speedsGbps: [100, 40], lengthM: 2, color: '#111827', accuracy: 'industry' });
add({ id: 'dac-qsfp28-3m', name: 'QSFP28 passive DAC, 100G, 3 m', shortName: 'QSFP28 DAC 3m', media: 'dac', ends: ['qsfp28', 'qsfp28'], speedsGbps: [100, 40], lengthM: 3, color: '#111827', accuracy: 'industry' });
add({ id: 'dac-qsfpdd-2m', name: 'QSFP-DD passive DAC, 400G, 2 m', shortName: 'QSFP-DD DAC 2m', media: 'dac', ends: ['qsfp_dd', 'qsfp_dd'], speedsGbps: [400, 200, 100], lengthM: 2, color: '#111827', accuracy: 'industry' });
add({ id: 'aoc-qsfp28-30m', name: 'QSFP28 active optical cable, 100G, 30 m', shortName: 'QSFP28 AOC 30m', media: 'aoc', ends: ['qsfp28', 'qsfp28'], speedsGbps: [100], lengthM: 30, color: '#06b6d4', accuracy: 'industry' });

// Passive fibre (transceivers decide the speed)
add({ id: 'mpo-om4-30m', name: 'MPO-12 multimode fibre trunk (OM4), 30 m', shortName: 'MPO OM4 30m', media: 'mmf', ends: ['mpo12', 'mpo12'], lengthM: 30, color: '#a855f7', accuracy: 'industry', note: 'Used with parallel SR4/SR8 optics.' });
add({ id: 'mpo-os2-30m', name: 'MPO-12 single-mode fibre trunk (OS2), 30 m', shortName: 'MPO OS2 30m', media: 'smf', ends: ['mpo12', 'mpo12'], lengthM: 30, color: '#facc15', accuracy: 'industry', note: 'Used with parallel DR4 optics.' });
add({ id: 'lc-om4-20m', name: 'LC duplex multimode fibre (OM4), 20 m', shortName: 'LC OM4 20m', media: 'mmf', ends: ['lc_duplex', 'lc_duplex'], lengthM: 20, color: '#22d3ee', accuracy: 'industry' });
add({ id: 'lc-os2-20m', name: 'LC duplex single-mode fibre (OS2), 20 m', shortName: 'LC OS2 20m', media: 'smf', ends: ['lc_duplex', 'lc_duplex'], lengthM: 20, color: '#fde047', accuracy: 'industry' });

// Power
add({ id: 'pwr-c13c14-2m', name: 'Power cord C13 → C14, 2 m', shortName: 'C13/C14 2m', media: 'power', ends: ['c13', 'c14'], lengthM: 2, color: '#1f2937', accuracy: 'industry', note: 'C13 end plugs into the device inlet (C14); C14 end plugs into the PDU outlet (C13).' });
add({ id: 'pwr-c19c20-2m', name: 'Power cord C19 → C20, 2 m', shortName: 'C19/C20 2m', media: 'power', ends: ['c19', 'c20'], lengthM: 2, color: '#1f2937', accuracy: 'industry', note: 'High-current cord for PSUs above about 2 kW.' });
add({ id: 'pwr-laptop-adapter', name: 'Laptop power adapter (C14 → USB-C PD)', shortName: 'Laptop PSU', media: 'power', ends: ['c14', 'usb_c'], lengthM: 2, color: '#374151', accuracy: 'industry' });

// Peripherals
add({ id: 'usb-a-c-1m', name: 'USB-A to USB-C cable, 1 m', shortName: 'USB A–C', media: 'usb', ends: ['usb_a', 'usb_c'], lengthM: 1, color: '#9ca3af', accuracy: 'industry' });
add({ id: 'console-rj45-usb', name: 'Serial console cable (RJ45 rollover → USB-A)', shortName: 'Console', media: 'console', ends: ['rj45', 'usb_a'], lengthM: 1.8, console: true, color: '#60a5fa', accuracy: 'industry', note: 'Carries RS-232 console signals. An Ethernet patch cord fits the RJ45 console port but carries no console signal.' });

export const TRANSCEIVER_MODELS: Record<string, TransceiverModel> = {
  'xcvr-sfpp-sr': { id: 'xcvr-sfpp-sr', name: 'SFP+ 10GBASE-SR', formFactor: 'sfp_plus', receptacle: 'lc_duplex', media: 'mmf', speedsGbps: [10], reachM: 300, accuracy: 'industry' },
  'xcvr-sfp28-sr': { id: 'xcvr-sfp28-sr', name: 'SFP28 25GBASE-SR', formFactor: 'sfp28', receptacle: 'lc_duplex', media: 'mmf', speedsGbps: [25, 10], reachM: 100, accuracy: 'industry' },
  'xcvr-sfp28-lr': { id: 'xcvr-sfp28-lr', name: 'SFP28 25GBASE-LR', formFactor: 'sfp28', receptacle: 'lc_duplex', media: 'smf', speedsGbps: [25, 10], reachM: 10000, accuracy: 'industry' },
  'xcvr-qsfp28-sr4': { id: 'xcvr-qsfp28-sr4', name: 'QSFP28 100GBASE-SR4', formFactor: 'qsfp28', receptacle: 'mpo12', media: 'mmf', speedsGbps: [100], reachM: 100, accuracy: 'industry' },
  'xcvr-qsfp112-sr4': { id: 'xcvr-qsfp112-sr4', name: 'QSFP112 400G SR4', formFactor: 'qsfp112', receptacle: 'mpo12', media: 'mmf', speedsGbps: [400, 200, 100], reachM: 50, accuracy: 'industry' },
  'xcvr-qsfpdd-sr8': { id: 'xcvr-qsfpdd-sr8', name: 'QSFP-DD 400G SR8 (MPO-12 simplified)', formFactor: 'qsfp_dd', receptacle: 'mpo12', media: 'mmf', speedsGbps: [400, 200, 100], reachM: 100, accuracy: 'simplified', note: 'Real SR8 optics use MPO-16; simplified to MPO-12 here.' },
  'xcvr-osfp-400-sr4': { id: 'xcvr-osfp-400-sr4', name: 'OSFP 400G SR4 (multimode)', formFactor: 'osfp', receptacle: 'mpo12', media: 'mmf', speedsGbps: [400, 200], reachM: 50, accuracy: 'simplified' },
  'xcvr-osfp-800-sr8': { id: 'xcvr-osfp-800-sr8', name: 'OSFP 800G SR8 (simplified single MPO)', formFactor: 'osfp', receptacle: 'mpo12', media: 'mmf', speedsGbps: [800, 400, 200], reachM: 50, accuracy: 'simplified', note: 'Real twin-port 800G optics expose two MPO connectors.' },
  'xcvr-osfp-400-dr4': { id: 'xcvr-osfp-400-dr4', name: 'OSFP 400G DR4 (single-mode)', formFactor: 'osfp', receptacle: 'mpo12', media: 'smf', speedsGbps: [400], reachM: 500, accuracy: 'simplified' },
};

export function getCableModel(id: string): CableModel {
  const m = CABLE_MODELS[id];
  if (!m) throw new Error(`Unknown cable model: ${id}`);
  return m;
}

export function getTransceiverModel(id: string): TransceiverModel {
  const m = TRANSCEIVER_MODELS[id];
  if (!m) throw new Error(`Unknown transceiver model: ${id}`);
  return m;
}
