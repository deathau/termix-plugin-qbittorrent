import { useState } from "react";
import {
  useToast,
  useTranslation,
  type TermixApp,
} from "@termix-ssh/plugin-sdk/frontend";
import {
  FormFooter,
  InlineView,
  SelectField,
  SwitchRow,
  TextAreaField,
  TextField,
} from "@termix-ssh/plugin-sdk/ui";
import { parseLinks, parseTags, type AddBody } from "./torrents.js";

const NO_CATEGORY = "none";

export function AddTorrentView({
  app,
  open,
  onOpenChange,
  categories,
  onAdded,
}: {
  app: TermixApp;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: string[];
  onAdded: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [links, setLinks] = useState("");
  const [savePath, setSavePath] = useState("");
  const [category, setCategory] = useState(NO_CATEGORY);
  const [tags, setTags] = useState("");
  const [stopped, setStopped] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async () => {
    const urls = parseLinks(links);
    if (urls.length === 0) {
      setError(t("tab.addView.noLinks"));
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const { data: body } = await app.api.post<AddBody>("/torrents/add", {
        urls,
        savePath: savePath.trim() || undefined,
        category: category === NO_CATEGORY ? undefined : category,
        tags: parseTags(tags),
        stopped,
      });
      if (body.ok === false) {
        setError(body.error.message);
        return;
      }
      const message = t("tab.addView.added", {
        added: body.added,
        pending: body.pending,
        failed: body.failed,
      });
      if (body.failed > 0) toast.warning(message);
      else toast.success(message);
      setLinks("");
      setTags("");
      onAdded();
      onOpenChange(false);
    } catch (err) {
      // A 400 carries the reason in the same body shape as the others.
      const body = (err as { response?: { data?: AddBody } }).response?.data;
      setError(body?.ok === false ? body.error.message : t("tab.failedAction"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <InlineView
      open={open}
      onOpenChange={onOpenChange}
      title={t("tab.addView.title")}
      footer={
        <FormFooter
          onCancel={() => onOpenChange(false)}
          onSave={() => void submit()}
          saveLabel={t("tab.addView.submit")}
          cancelLabel={t("tab.addView.cancel")}
          saving={saving}
        />
      }
    >
      <div className="flex flex-col gap-3 p-4">
        <TextAreaField
          label={t("tab.addView.links")}
          hint={t("tab.addView.linksHint")}
          value={links}
          onChange={setLinks}
          rows={5}
          mono
          error={error}
        />
        <TextField
          label={t("tab.addView.savePath")}
          hint={t("tab.addView.savePathHint")}
          value={savePath}
          onChange={setSavePath}
          mono
        />
        <SelectField
          label={t("tab.addView.category")}
          value={category}
          onChange={setCategory}
          options={[
            { value: NO_CATEGORY, label: t("tab.addView.noCategory") },
            ...categories.map((name) => ({ value: name, label: name })),
          ]}
        />
        <TextField
          label={t("tab.addView.tags")}
          hint={t("tab.addView.tagsHint")}
          value={tags}
          onChange={setTags}
        />
        <SwitchRow
          label={t("tab.addView.stopped")}
          description={t("tab.addView.stoppedHint")}
          checked={stopped}
          onChange={setStopped}
        />
      </div>
    </InlineView>
  );
}
