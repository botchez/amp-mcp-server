import { ADS } from "@neuralnexus/ampapi";
import type { CommonAPI, IADSInstance, Instance, LoginResult, UUID } from "@neuralnexus/ampapi";

export interface AmpClientOptions {
  baseUri: string;
  username: string;
  password: string;
}

export interface FlatInstance extends Instance {
  TargetFriendlyName: string;
  TargetId: UUID;
}

export class AmpClient {
  private readonly opts: AmpClientOptions;
  private controllerPromise: Promise<ADS> | null = null;
  private readonly instanceCache = new Map<string, Promise<CommonAPI>>();

  constructor(opts: AmpClientOptions) {
    this.opts = opts;
  }

  static fromEnv(): AmpClient {
    const { AMP_URL, AMP_USERNAME, AMP_PASSWORD } = process.env;
    if (!AMP_URL || !AMP_USERNAME || !AMP_PASSWORD) {
      throw new Error(
        "amp-mcp-server: AMP_URL, AMP_USERNAME, and AMP_PASSWORD must be set in the environment.",
      );
    }
    return new AmpClient({ baseUri: AMP_URL, username: AMP_USERNAME, password: AMP_PASSWORD });
  }

  async getController(): Promise<ADS> {
    if (!this.controllerPromise) {
      this.controllerPromise = this.loginController().catch((err) => {
        this.controllerPromise = null;
        throw err;
      });
    }
    return this.controllerPromise;
  }

  private async loginController(): Promise<ADS> {
    const ads = new ADS(this.opts.baseUri, this.opts.username, this.opts.password);
    const result = (await ads.APILogin()) as LoginResult | undefined;
    if (!result || result.success === false) {
      const reason = result?.resultReason?.trim();
      const code = result?.result;
      const detail =
        reason ||
        (code === 0
          ? "invalid credentials or account not authorized for API access"
          : `result code ${code ?? "unknown"}`);
      throw new Error(`AMP login failed (${detail}). Verify AMP_USERNAME, AMP_PASSWORD, and that the account has the necessary AMP role.`);
    }
    return ads;
  }

  async listInstances(): Promise<FlatInstance[]> {
    const controller = await this.getController();
    const targets = await controller.ADSModule.GetInstances();
    return targets.flatMap((t: IADSInstance) =>
      t.AvailableInstances.map(
        (inst): FlatInstance => ({
          ...inst,
          TargetFriendlyName: t.FriendlyName,
          TargetId: t.InstanceId,
        }),
      ),
    );
  }

  async getInstance(instanceId: string): Promise<CommonAPI> {
    const cached = this.instanceCache.get(instanceId);
    if (cached) return cached;

    const promise = this.loginInstance(instanceId).catch((err) => {
      this.instanceCache.delete(instanceId);
      throw err;
    });
    this.instanceCache.set(instanceId, promise);
    return promise;
  }

  private async loginInstance(instanceId: string): Promise<CommonAPI> {
    const all = await this.listInstances();
    const inst = all.find((i) => i.InstanceID === instanceId);
    if (!inst) {
      throw new Error(`Instance not found: ${instanceId}`);
    }
    const controller = await this.getController();
    return controller.InstanceLogin<CommonAPI>(instanceId, inst.Module);
  }
}
