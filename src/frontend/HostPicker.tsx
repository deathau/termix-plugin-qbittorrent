import {
  useHosts,
  useTranslation,
  type SettingsComponentProps,
} from "@termix-ssh/plugin-sdk/frontend";
import { SelectField } from "@termix-ssh/plugin-sdk/ui";

export const HOST_PICKER_ID = "qbittorrent-host-picker";

// The select can't hold an empty value, so "no host" needs a stand-in.
const NONE = "none";

/** The `fileHostId` admin setting. The SDK has no host picker of its own. */
export function HostPicker({ values, setValue }: SettingsComponentProps) {
  const { t } = useTranslation();
  const { hosts } = useHosts();
  const current = values.fileHostId;
  const value = current ? String(current) : NONE;

  return (
    <SelectField
      label={t("settings.admin.fileHostId.label")}
      hint={t("settings.admin.fileHostId.description")}
      value={value}
      onChange={(next) => setValue("fileHostId", next === NONE ? "" : next)}
      options={[
        { value: NONE, label: t("settings.admin.fileHostId.none") },
        ...hosts.map((host) => ({ value: String(host.id), label: host.name })),
      ]}
    />
  );
}
