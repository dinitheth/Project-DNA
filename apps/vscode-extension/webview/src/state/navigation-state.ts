import {
  SidebarRouteSchema,
  type ExtensionMessage,
  type SidebarRoute,
  type WebviewMessage,
} from '@project-dna/shared';

export interface NavigationState {
  readonly route: SidebarRoute;
  readonly generation: number;
  readonly revision: number;
}

interface PendingNavigation {
  readonly requestId: number;
  readonly route: SidebarRoute;
  readonly generation: number;
  readonly revision: number;
}

interface PersistedNavigationState extends NavigationState {
  readonly inFlight?: PendingNavigation;
  readonly queuedRoute?: SidebarRoute;
  readonly nextRequestId: number;
}

interface NavigationTransport {
  getState(): unknown;
  setState(state: PersistedNavigationState): void;
  postMessage(message: WebviewMessage): void;
}

export const initialNavigationState: NavigationState = {
  route: 'overview',
  generation: 0,
  revision: 0,
};

export function createInitialNavigationState(candidate: unknown): NavigationState {
  const restored = restoreNavigationState(candidate);
  return {
    route: restored.route,
    generation: restored.generation,
    revision: restored.revision,
  };
}

export class SidebarNavigationController {
  private state: NavigationState;
  private inFlight: PendingNavigation | undefined;
  private queuedRoute: SidebarRoute | undefined;
  private nextRequestId: number;
  private started = false;
  private listener: ((state: NavigationState) => void) | undefined;

  constructor(private readonly transport: NavigationTransport) {
    const restored = restoreNavigationState(transport.getState());
    this.state = {
      route: restored.route,
      generation: restored.generation,
      revision: restored.revision,
    };
    this.inFlight = restored.inFlight;
    this.queuedRoute = restored.queuedRoute;
    this.nextRequestId = restored.nextRequestId;
  }

  public getSnapshot(): NavigationState {
    return this.state;
  }

  public subscribe(listener: (state: NavigationState) => void): () => void {
    this.listener = listener;
    return () => {
      if (this.listener === listener) this.listener = undefined;
    };
  }

  public start(): void {
    if (this.started) return;
    this.started = true;
    this.persist();
    this.transport.postMessage({ type: 'ready', ...this.state });
    if (this.inFlight) {
      this.transport.postMessage({ type: 'navigateTo', ...this.inFlight });
    }
  }

  public navigate(route: SidebarRoute): void {
    if (route === this.state.route) return;
    this.state = { ...this.state, route };
    if (this.inFlight) {
      this.queuedRoute = route;
    } else {
      this.sendRequest(route);
    }
    this.persistAndPublish();
  }

  public receive(message: Extract<ExtensionMessage, { type: 'navigateTo' }>): void {
    if (
      !isNewerNavigationVersion(
        message.generation,
        message.revision,
        this.state.generation,
        this.state.revision,
      )
    ) {
      return;
    }

    const acknowledgedVersion = this.inFlight
      ? nextNavigationVersion(this.inFlight.generation, this.inFlight.revision)
      : undefined;
    const acknowledgesInFlight =
      message.requestId !== undefined &&
      message.requestId === this.inFlight?.requestId &&
      message.generation === acknowledgedVersion?.generation &&
      message.revision === acknowledgedVersion.revision;
    if (!acknowledgesInFlight) {
      this.inFlight = undefined;
      this.queuedRoute = undefined;
      this.state = {
        route: message.route,
        generation: message.generation,
        revision: message.revision,
      };
      this.persistAndPublish();
      return;
    }

    this.inFlight = undefined;
    const queuedRoute = this.queuedRoute;
    this.queuedRoute = undefined;
    this.state = {
      route: queuedRoute ?? message.route,
      generation: message.generation,
      revision: message.revision,
    };
    if (queuedRoute !== undefined && queuedRoute !== message.route) {
      this.sendRequest(queuedRoute);
    }
    this.persistAndPublish();
  }

  private sendRequest(route: SidebarRoute): void {
    if (this.nextRequestId === Number.MAX_SAFE_INTEGER) {
      throw new Error('Sidebar navigation request ID space is exhausted.');
    }
    const requestId = this.nextRequestId++;
    this.inFlight = {
      requestId,
      route,
      generation: this.state.generation,
      revision: this.state.revision,
    };
    this.transport.postMessage({
      type: 'navigateTo',
      route,
      generation: this.state.generation,
      revision: this.state.revision,
      requestId,
    });
  }

  private persistAndPublish(): void {
    this.persist();
    this.listener?.(this.state);
  }

  private persist(): void {
    this.transport.setState({
      ...this.state,
      inFlight: this.inFlight,
      queuedRoute: this.queuedRoute,
      nextRequestId: this.nextRequestId,
    });
  }
}

function restoreNavigationState(candidate: unknown): PersistedNavigationState {
  if (!candidate || typeof candidate !== 'object') return initialPersistedNavigationState();
  const state = candidate as Record<string, unknown>;
  const route = SidebarRouteSchema.safeParse(state.route);
  const queuedRoute = SidebarRouteSchema.optional().safeParse(state.queuedRoute);
  const inFlight = restorePendingNavigation(state.inFlight);
  if (
    !route.success ||
    !queuedRoute.success ||
    !isSafeNonnegativeInteger(state.generation) ||
    !isSafeNonnegativeInteger(state.revision) ||
    (state.nextRequestId !== undefined && !isSafeNonnegativeInteger(state.nextRequestId)) ||
    (state.inFlight !== undefined && !inFlight)
  ) {
    return initialPersistedNavigationState();
  }
  return {
    route: route.data,
    generation: state.generation,
    revision: state.revision,
    inFlight,
    queuedRoute: queuedRoute.data,
    nextRequestId: state.nextRequestId ?? 0,
  };
}

function restorePendingNavigation(candidate: unknown): PendingNavigation | undefined {
  if (candidate === undefined) return undefined;
  if (!candidate || typeof candidate !== 'object') return undefined;
  const pending = candidate as Record<string, unknown>;
  const route = SidebarRouteSchema.safeParse(pending.route);
  if (
    !route.success ||
    !isSafeNonnegativeInteger(pending.requestId) ||
    !isSafeNonnegativeInteger(pending.generation) ||
    !isSafeNonnegativeInteger(pending.revision)
  ) {
    return undefined;
  }
  return {
    requestId: pending.requestId,
    route: route.data,
    generation: pending.generation,
    revision: pending.revision,
  };
}

function initialPersistedNavigationState(): PersistedNavigationState {
  return { ...initialNavigationState, nextRequestId: 0 };
}

function isSafeNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function nextNavigationVersion(generation: number, revision: number) {
  return revision === Number.MAX_SAFE_INTEGER
    ? { generation: generation + 1, revision: 0 }
    : { generation, revision: revision + 1 };
}

function isNewerNavigationVersion(
  generation: number,
  revision: number,
  currentGeneration: number,
  currentRevision: number,
): boolean {
  return (
    generation > currentGeneration ||
    (generation === currentGeneration && revision > currentRevision)
  );
}
