import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import si from 'systeminformation';
import type { HardwareSnapshot } from '@sevenvid/ipc';
import type { EventBus } from '../events/EventBus';
import type { FfmpegLocation } from '../ffmpeg/locator';
import type { Logger } from '../logging/logger';
import type { AppPaths } from '../paths/AppPaths';

const execFileAsync = promisify(execFile);

export interface PythonProbe {
  available: boolean;
  version: string | null;
  path: string | null;
  venvReady: boolean;
  device: string | null;
}

type GpuInfo = HardwareSnapshot['gpus'][number];

export class HardwareMonitor {
  private last: HardwareSnapshot | null = null;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<HardwareSnapshot> | null = null;
  private pythonProbe: (() => Promise<PythonProbe>) | null = null;

  constructor(
    private readonly paths: AppPaths,
    private readonly bus: EventBus,
    private readonly logger: Logger,
    private ffmpeg: FfmpegLocation,
  ) {}

  setFfmpeg(location: FfmpegLocation): void {
    this.ffmpeg = location;
  }

  setPythonProbe(probe: () => Promise<PythonProbe>): void {
    this.pythonProbe = probe;
  }

  get current(): HardwareSnapshot | null {
    return this.last;
  }

  async snapshot(refresh = false): Promise<HardwareSnapshot> {
    if (!refresh && this.last && Date.now() - Date.parse(this.last.at) < 4000) return this.last;
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.collect().finally(() => (this.inFlight = null));
    return this.inFlight;
  }

  start(intervalMs = 5000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.snapshot(true).catch((err) => this.logger.warn({ module: 'hardware', err }, 'hardware poll failed'));
    }, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async collect(): Promise<HardwareSnapshot> {
    const [osInfo, cpu, load, mem, graphics, fsSize] = await Promise.all([
      si.osInfo().catch(() => null),
      si.cpu().catch(() => null),
      si.currentLoad().catch(() => null),
      si.mem().catch(() => null),
      si.graphics().catch(() => null),
      si.fsSize().catch(() => [] as si.Systeminformation.FsSizeData[]),
    ]);
    const nvidia = await this.queryNvidiaSmi();
    const gpus: GpuInfo[] = [];
    for (const c of graphics?.controllers ?? []) {
      const model = c.model || 'Unknown GPU';
      const vendor = (c.vendor || '').toLowerCase();
      const kind: GpuInfo['kind'] = vendor.includes('nvidia') || model.toLowerCase().includes('nvidia') ? 'nvidia' : vendor.includes('amd') || vendor.includes('ati') || model.toLowerCase().includes('radeon') ? 'amd' : vendor.includes('intel') ? 'intel' : vendor.includes('apple') ? 'apple' : 'other';
      const nv = nvidia.find((n) => model.includes(n.name) || n.name.includes(model));
      gpus.push({
        vendor: c.vendor || kind,
        model,
        vramMb: nv?.totalMb ?? (c.vram ? Math.round(c.vram) : null),
        vramUsedMb: nv?.usedMb ?? (c.memoryUsed ? Math.round(c.memoryUsed) : null),
        utilizationPercent: nv?.utilization ?? (typeof c.utilizationGpu === 'number' ? c.utilizationGpu : null),
        temperatureC: nv?.temperature ?? (typeof c.temperatureGpu === 'number' ? c.temperatureGpu : null),
        driver: nv?.driver ?? c.driverVersion ?? null,
        kind,
        supportsCuda: Boolean(nv),
      });
    }
    for (const nv of nvidia) {
      if (!gpus.some((g) => g.model.includes(nv.name) || nv.name.includes(g.model))) {
        gpus.push({ vendor: 'NVIDIA', model: nv.name, vramMb: nv.totalMb, vramUsedMb: nv.usedMb, utilizationPercent: nv.utilization, temperatureC: nv.temperature, driver: nv.driver, kind: 'nvidia', supportsCuda: true });
      }
    }
    const disks = (fsSize ?? [])
      .filter((d) => d.size > 0 && !/^(\/boot|\/snap|\/dev|\/proc|\/sys|\/run)/.test(d.mount))
      .map((d) => ({ mount: d.mount, fs: d.fs, sizeMb: Math.round(d.size / 1048576), usedMb: Math.round(d.used / 1048576), availableMb: Math.round((d.available ?? d.size - d.used) / 1048576) }));
    const dataDisk = this.diskFor(this.paths.userData);
    let python: PythonProbe = { available: false, version: null, path: null, venvReady: false, device: null };
    if (this.pythonProbe) {
      try {
        python = await this.pythonProbe();
      } catch (err) {
        this.logger.warn({ module: 'hardware', err }, 'python probe failed');
      }
    }
    const snapshot: HardwareSnapshot = {
      at: new Date().toISOString(),
      os: { platform: process.platform, distro: osInfo?.distro ?? '', release: osInfo?.release ?? '', arch: process.arch },
      cpu: { brand: cpu ? `${cpu.manufacturer} ${cpu.brand}`.trim() : 'Unknown CPU', cores: cpu?.cores ?? 0, physicalCores: cpu?.physicalCores ?? 0, speedGhz: cpu?.speed ?? null, loadPercent: load ? Math.round(load.currentLoad) : null },
      memory: { totalMb: Math.round((mem?.total ?? 0) / 1048576), usedMb: Math.round((mem?.active ?? mem?.used ?? 0) / 1048576), availableMb: Math.round((mem?.available ?? 0) / 1048576) },
      gpus,
      disks,
      dataDisk,
      ffmpeg: { available: Boolean(this.ffmpeg.ffmpeg), version: this.ffmpeg.version, path: this.ffmpeg.ffmpeg, hwEncoders: this.ffmpeg.hwEncoders },
      python,
    };
    this.last = snapshot;
    this.bus.emit('hardware.updated', snapshot);
    return snapshot;
  }

  private diskFor(p: string): HardwareSnapshot['dataDisk'] {
    try {
      const st = fs.statfsSync(fs.existsSync(p) ? p : path.dirname(p));
      return { mount: p, sizeMb: Math.round((Number(st.blocks) * Number(st.bsize)) / 1048576), availableMb: Math.round((Number(st.bavail) * Number(st.bsize)) / 1048576) };
    } catch {
      return null;
    }
  }

  private async queryNvidiaSmi(): Promise<Array<{ name: string; totalMb: number; usedMb: number; utilization: number; temperature: number; driver: string }>> {
    try {
      const { stdout } = await execFileAsync('nvidia-smi', ['--query-gpu=name,memory.total,memory.used,utilization.gpu,temperature.gpu,driver_version', '--format=csv,noheader,nounits'], { timeout: 3000 });
      return stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [name, total, used, util, temp, driver] = line.split(',').map((s) => s.trim());
          return { name: name ?? 'NVIDIA GPU', totalMb: Number(total), usedMb: Number(used), utilization: Number(util), temperature: Number(temp), driver: driver ?? '' };
        });
    } catch {
      return [];
    }
  }
}
