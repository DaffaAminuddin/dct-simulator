import { describe, expect, it } from 'vitest';
import type { SimulationEngine } from '@/simulation/core/SimulationEngine';
import { advanceS, makeEngine, ok, unplug } from '@/test/engine';
import { complete, execute } from './CommandExecutor';
import { parse } from './CommandParser';
import { stripAnsi } from './commands/util';
import { newSession, topFrame } from './Session';

function spare(e: SimulationEngine, modelId: string): string {
  const c = Object.values(e.getState().cables).find((x) => x.modelId === modelId && !x.ends[0].portId && !x.ends[1].portId);
  if (!c) throw new Error(`no spare ${modelId}`);
  return c.id;
}

function term(e: SimulationEngine) {
  let session = newSession();
  const env = { getState: () => e.getState(), dispatch: (a: Parameters<SimulationEngine['dispatch']>[0]) => e.dispatch(a) };
  return {
    run(line: string) {
      const r = execute(env, session, line);
      session = r.session;
      return { out: r.lines.map(stripAnsi).join('\n'), exit: r.exit };
    },
    get frame() {
      return topFrame(session);
    },
  };
}

function onOob(e: SimulationEngine) {
  const id = spare(e, 'cat6-2m');
  ok(e, { type: 'cable/connect', cableId: id, end: 0, portId: 'laptop-01:eth0' });
  ok(e, { type: 'cable/connect', cableId: id, end: 1, portId: 'oob-r01:ge48' });
}

describe('CommandParser', () => {
  const env = { home: '/home/dct', vars: { USER: 'dct', '?': '0' } };
  it('handles quotes, pipes, sequences and ~', () => {
    const r = parse(`grep -i "xid 79" ~/log | wc -l && echo 'a b'; echo $USER`, env);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pipelines).toHaveLength(3);
    expect(r.pipelines[0].commands[0].argv).toEqual(['grep', '-i', 'xid 79', '/home/dct/log']);
    expect(r.pipelines[0].commands[1].argv).toEqual(['wc', '-l']);
    expect(r.pipelines[1].commands[0].argv).toEqual(['echo', 'a b']);
    expect(r.pipelines[2].commands[0].argv).toEqual(['echo', 'dct']);
  });
  it('rejects redirection and command substitution', () => {
    expect(parse('echo hi > /tmp/x', env).ok).toBe(false);
    expect(parse('echo $(id)', env).ok).toBe(false);
    expect(parse('ls |', env).ok).toBe(false);
  });
});

describe('terminal: laptop → BMC → host', () => {
  it('SSH to a BMC needs the admin account and a working management path', () => {
    const e = makeEngine();
    onOob(e);
    const t = term(e);
    expect(t.run('ssh dh1-r01-n01-bmc').out).toMatch(/Permission denied/);
    expect(t.run('ssh admin@dh1-r01-n01-bmc').exit).toBe(0);
    expect(t.frame.kind).toBe('bmc');
    expect(t.run('power status').out).toBe('Chassis Power is on');
    t.run('exit');
    unplug(e, 'srv-r01-01:bmc');
    expect(t.run('ssh admin@dh1-r01-n01-bmc').out).toMatch(/port 22: (No route to host|Connection timed out)/);
  });

  it('sol activate opens the host shell; host commands read the engine', () => {
    const e = makeEngine();
    onOob(e);
    const t = term(e);
    t.run('ssh admin@dh1-r01-n01-bmc');
    t.run('sol activate');
    expect(t.frame).toMatchObject({ kind: 'host', host: 'dh1-r01-n01', via: 'sol' });
    expect(t.run('hostname').out).toBe('dh1-r01-n01');
    expect(t.run('nvidia-smi').exit).toBe(127);
    expect(t.run('ip -br a').out).toMatch(/10\.100\.1\.11\/16/);
    expect(t.run('cat /etc/hostname').out).toBe('dh1-r01-n01');
    expect(t.run('dmesg').out).toMatch(/Operation not permitted/);
    expect(t.run('sudo dmesg | grep -c pci').exit).toBe(0);
  });

  it('nvidia-smi draws an aligned table', () => {
    const e = makeEngine();
    onOob(e);
    const t = term(e);
    t.run('ssh admin@dh1-r03-g01-bmc');
    t.run('sol activate');
    const rows = t.run('nvidia-smi').out.split('\n').filter((l) => /^[|+]/.test(l));
    expect(rows.length).toBeGreaterThan(20);
    for (const r of rows) expect(r.length, r).toBe(91);
  });

  it('a GPU that fell off the bus shows in nvidia-smi, lspci and dmesg', () => {
    const e = makeEngine();
    onOob(e);
    ok(e, { type: 'fault/inject', faultType: 'gpu_fallen_off_bus', targetId: e.getState().equipment['srv-r03-g01'].slots.gpu0 as string });
    const t = term(e);
    t.run('ssh admin@dh1-r03-g01-bmc');
    t.run('sol activate');
    expect(t.run('nvidia-smi').out).toMatch(/Unable to determine the device handle for GPU00000000:18:00\.0/);
    expect(t.run('nvidia-smi -L | wc -l').out).toBe('8');
    expect(t.run('lspci | grep -i "rev ff"').out).toMatch(/18:00\.0 3D controller/);
    expect(t.run('sudo dmesg | grep -i xid').out).toMatch(/Xid .*: 79/);
  });

  it('modprobe -r nvidia gives the driver error; reboot drops the session and reloads the driver', () => {
    const e = makeEngine();
    onOob(e);
    const t = term(e);
    t.run('ssh admin@dh1-r03-g01-bmc');
    t.run('sol activate');
    t.run('sudo modprobe -r nvidia');
    expect(t.run('nvidia-smi').out).toMatch(/couldn't communicate with the NVIDIA driver/);
    t.run('sudo reboot');
    expect(t.frame.kind).toBe('bmc');
    advanceS(e, 40);
    t.run('sol activate');
    expect(t.run('nvidia-smi -L').out.split('\n')).toHaveLength(8);
  });

  it('ip link set down takes the interface and its switch link down', () => {
    const e = makeEngine();
    onOob(e);
    const t = term(e);
    t.run('ssh admin@dh1-r01-n01-bmc');
    t.run('sol activate');
    expect(t.run('ip link set dev ens1f1np1 down').out).toMatch(/Operation not permitted/);
    t.run('sudo ip link set dev ens1f1np1 down');
    expect(t.run('ip -br link').out).toMatch(/ens1f1np1\s+DOWN/);
    expect(e.getState().ports['srv-r01-01:ocp0.p1'].state).toBe('disabled');
  });

  it('the OOB network cannot reach host data addresses; hosts reach each other over the data network', () => {
    const e = makeEngine();
    onOob(e);
    const t = term(e);
    expect(t.run('ssh dct@10.100.1.11').out).toMatch(/Connection timed out/);
    t.run('ssh admin@dh1-r01-n01-bmc');
    t.run('sol activate');
    expect(t.run('ping -c 2 dh1-r01-n02').out).toMatch(/2 received, 0% packet loss/);
    expect(t.run('ping -c 1 dh1-r01-n02-bmc').out).toMatch(/Name or service not known/);
    expect(t.run('ssh dh1-r01-n02 hostname').out).toMatch(/dh1-r01-n02/);
    expect(t.frame.host).toBe('dh1-r01-n01');
    t.run('ssh dh1-r01-n02');
    expect(t.frame).toMatchObject({ host: 'dh1-r01-n02', via: 'ssh' });
  });

  it('ipmitool over lanplus needs the admin account', () => {
    const e = makeEngine();
    onOob(e);
    const t = term(e);
    expect(t.run('ipmitool -I lanplus -H dh1-r02-n04-bmc -U dct power status').out).toMatch(/Unable to establish IPMI v2/);
    expect(t.run('ipmitool -I lanplus -H dh1-r02-n04-bmc -U admin power status').out).toBe('Chassis Power is on');
    expect(t.run('ipmitool -I lanplus -H dh1-r02-n04-bmc -U admin sdr | grep PSU2').out).toMatch(/PSU2 Status\s+\| Power Supply AC lost\s+\| cr/);
    expect(t.run('ipmitool -I lanplus -H dh1-r02-n04-bmc -U admin sel elist').exit).toBe(0);
  });

  it('the serial console cable gives a host shell without any network', () => {
    const e = makeEngine();
    const t = term(e);
    expect(t.run('console').out).toMatch(/no serial console attached/);
    const id = spare(e, 'console-rj45-usb');
    ok(e, { type: 'cable/connect', cableId: id, end: 1, portId: 'laptop-01:usb0' });
    ok(e, { type: 'cable/connect', cableId: id, end: 0, portId: 'srv-r01-01:console' });
    expect(t.run('lsusb').out).toMatch(/USB-to-serial console adapter/);
    expect(t.run('screen /dev/ttyUSB0 115200').out).toMatch(/dh1-r01-n01 login: dct/);
    expect(t.frame).toMatchObject({ host: 'dh1-r01-n01', via: 'serial' });
    unplug(e, 'srv-r01-01:console');
    expect(t.run('hostname').out).toMatch(/screen is terminating/);
    expect(t.frame.kind).toBe('laptop');
  });

  it('tab completion covers commands, paths and host names', () => {
    const e = makeEngine();
    onOob(e);
    const s = newSession();
    expect(complete(e.getState(), s, 'nvid').options).toEqual([]);
    expect(complete(e.getState(), s, 'hostn').line).toBe('hostname ');
    expect(complete(e.getState(), s, 'cat REA').line).toBe('cat README.txt ');
    expect(complete(e.getState(), s, 'ls /etc/').options).toContain('hosts');
    expect(complete(e.getState(), s, 'ssh admin@dh1-r01-n01-b').line).toBe('ssh admin@dh1-r01-n01-bmc ');
  });

  it('sudo -i opens a root shell; exit returns to the user shell', () => {
    const e = makeEngine();
    const t = term(e);
    t.run('sudo -i');
    expect(t.frame).toMatchObject({ user: 'root', cwd: '/root' });
    expect(t.run('whoami').out).toBe('root');
    t.run('exit');
    expect(t.run('whoami').out).toBe('dct');
    expect(t.run('cat README.txt | head -1').out).toBe('Technician laptop (simulated)');
    expect(t.run('false || echo fallback').out).toBe('fallback');
    expect(t.run('true && echo yes; echo $?').out).toBe('yes\n0');
  });

  it('a host reboot through the BMC ends the SOL login', () => {
    const e = makeEngine();
    onOob(e);
    const t = term(e);
    t.run('ssh admin@dh1-r01-n01-bmc');
    t.run('sol activate');
    ok(e, { type: 'equipment/powerCycle', equipmentId: 'srv-r01-01' });
    expect(t.run('hostname').out).toMatch(/Login session ended/);
    expect(t.frame.kind).toBe('bmc');
  });
});
