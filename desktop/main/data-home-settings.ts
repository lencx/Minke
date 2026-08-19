import {
  DATA_HOME_CHOOSE_DIRECTORY_CHANNEL,
  DATA_HOME_MIGRATION_PLAN_CHANNEL,
  DATA_HOME_MIGRATION_SCHEDULE_CHANNEL,
  DATA_HOME_SETTINGS_READ_CHANNEL,
  parseDataHomeMigrationPlanRequest,
  parseDataHomeMigrationScheduleRequest,
  type DataHomeMigrationPlan,
  type DataHomeMigrationPlanRequest,
  type DataHomeMigrationScheduleRequest,
  type DataHomeMigrationScheduleResult,
  type DataHomeSettingsSnapshot,
} from "@minke/harness-overlay/data-home-contract.ts";

interface IpcMainLike {
  handle(
    channel: string,
    listener: (event: unknown, value?: unknown) => unknown,
  ): void;
  removeHandler(channel: string): void;
}

export interface DataHomeSettingsBinding {
  dispose(): void;
}

export interface DataHomeSettingsService {
  read(): Promise<DataHomeSettingsSnapshot>;
  chooseDirectory(): Promise<string | undefined>;
  plan(
    request: DataHomeMigrationPlanRequest,
  ): Promise<DataHomeMigrationPlan>;
  schedule(
    request: DataHomeMigrationScheduleRequest,
  ): Promise<DataHomeMigrationScheduleResult>;
}

/** Bind the authorized data-directory discovery and migration workflow. */
export function bindDataHomeSettingsIpc(
  ipcMain: IpcMainLike,
  service: DataHomeSettingsService,
  authorize: (event: unknown) => boolean,
): DataHomeSettingsBinding {
  const read = async (
    event: unknown,
  ): Promise<DataHomeSettingsSnapshot> => {
    assertAuthorized(authorize, event);
    return await service.read();
  };
  const chooseDirectory = async (
    event: unknown,
  ): Promise<string | undefined> => {
    assertAuthorized(authorize, event);
    return await service.chooseDirectory();
  };
  const plan = async (
    event: unknown,
    value?: unknown,
  ): Promise<DataHomeMigrationPlan> => {
    assertAuthorized(authorize, event);
    return await service.plan(
      parseDataHomeMigrationPlanRequest(value),
    );
  };
  const schedule = async (
    event: unknown,
    value?: unknown,
  ): Promise<DataHomeMigrationScheduleResult> => {
    assertAuthorized(authorize, event);
    return await service.schedule(
      parseDataHomeMigrationScheduleRequest(value),
    );
  };

  ipcMain.handle(DATA_HOME_SETTINGS_READ_CHANNEL, read);
  ipcMain.handle(
    DATA_HOME_CHOOSE_DIRECTORY_CHANNEL,
    chooseDirectory,
  );
  ipcMain.handle(DATA_HOME_MIGRATION_PLAN_CHANNEL, plan);
  ipcMain.handle(DATA_HOME_MIGRATION_SCHEDULE_CHANNEL, schedule);

  let disposed = false;
  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      ipcMain.removeHandler(DATA_HOME_SETTINGS_READ_CHANNEL);
      ipcMain.removeHandler(
        DATA_HOME_CHOOSE_DIRECTORY_CHANNEL,
      );
      ipcMain.removeHandler(DATA_HOME_MIGRATION_PLAN_CHANNEL);
      ipcMain.removeHandler(
        DATA_HOME_MIGRATION_SCHEDULE_CHANNEL,
      );
    },
  });
}

function assertAuthorized(
  authorize: (event: unknown) => boolean,
  event: unknown,
): void {
  if (!authorize(event)) {
    throw new Error("unauthorized data-home settings request");
  }
}
