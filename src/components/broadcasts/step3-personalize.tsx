'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Contact, CustomField, MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  ImageIcon,
  Loader2,
  Upload,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { extractTemplateVariables } from '@/lib/whatsapp/template-validators';
import {
  MEDIA_HEADER_SPECS,
  isMediaHeaderKind,
  type MediaHeaderKind,
} from '@/lib/whatsapp/media-header-types';
import {
  MEDIA_MAX_BYTES_BY_KIND,
  uploadAccountMedia,
} from '@/lib/storage/upload-media';

type VariableType = 'static' | 'field' | 'custom_field';

/**
 * Header type chosen for this broadcast. Defaults to the template's
 * stored `header_type`; when the local row has no metadata (e.g. a
 * template synced before header types were tracked) the user can pick
 * the type here and the override is threaded through to the send.
 */
export type BroadcastHeaderType = 'none' | MediaHeaderKind;

interface VariableMapping {
  type: VariableType;
  value: string;
}

interface Step3Props {
  template: MessageTemplate;
  variables: Record<string, VariableMapping>;
  onUpdate: (variables: Record<string, VariableMapping>) => void;
  /** Type of header this broadcast should send. */
  headerType: BroadcastHeaderType;
  onHeaderTypeChange: (type: BroadcastHeaderType) => void;
  /** Media URL for an IMAGE/VIDEO/DOCUMENT header, when one is chosen. */
  headerMediaUrl: string;
  onHeaderMediaUrlChange: (url: string) => void;
  onNext: () => void;
  onBack: () => void;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

const contactFields = [
  { value: 'name', labelKey: 'name' },
  { value: 'phone', labelKey: 'phone' },
  { value: 'email', labelKey: 'email' },
];

const SAMPLE_CONTACT: Contact = {
  id: 'sample',
  user_id: '',
  account_id: '',
  name: 'John Doe',
  phone: '+1234567890',
  email: 'john@example.com',
  company: 'Acme Corp',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

export function Step3Personalize({
  template,
  variables,
  onUpdate,
  headerType,
  onHeaderTypeChange,
  headerMediaUrl,
  onHeaderMediaUrlChange,
  onNext,
  onBack,
}: Step3Props) {
  const t = useTranslations('Broadcasts.wizard');
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [uploadingHeader, setUploadingHeader] = useState(false);
  const headerFileRef = useRef<HTMLInputElement>(null);
  const [loadingFields, setLoadingFields] = useState(true);
  const [firstContact, setFirstContact] = useState<Contact | null>(null);
  const [firstContactCustomValues, setFirstContactCustomValues] = useState<
    Map<string, string>
  >(new Map());
  const [loadingPreview, setLoadingPreview] = useState(true);

  // Load user's custom fields + a representative contact for the
  // live preview. Fall back to sample data if no contacts exist yet.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const [fieldsRes, contactRes] = await Promise.all([
        supabase.from('custom_fields').select('*').order('field_name'),
        supabase
          .from('contacts')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (cancelled) return;

      setCustomFields(fieldsRes.data ?? []);
      setLoadingFields(false);

      const contact = contactRes.data ?? null;
      setFirstContact(contact);

      if (contact) {
        const { data: customVals } = await supabase
          .from('contact_custom_values')
          .select('custom_field_id, value')
          .eq('contact_id', contact.id);
        if (!cancelled) {
          const map = new Map<string, string>();
          for (const row of customVals ?? []) {
            map.set(row.custom_field_id, row.value ?? '');
          }
          setFirstContactCustomValues(map);
        }
      }
      setLoadingPreview(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Positional {{1}} or named {{customer_name}} placeholders.
  const placeholders = useMemo(
    () => extractTemplateVariables(template.body_text).map((k) => `{{${k}}}`),
    [template.body_text],
  );

  // Meta requires the media component on every delivery for templates
  // with an IMAGE/VIDEO/DOCUMENT header — and rejects the send without
  // it. The chosen type comes from the wizard state (seeded from the
  // template's stored header_type) so the field stays usable even when
  // the local row is missing that metadata.
  const mediaHeaderType = isMediaHeaderKind(headerType) ? headerType : null;

  // Seed the field with the template's stored sample URL the first time
  // we land on a media-header template, so the common "reuse the
  // approved media" case needs no typing. Only seeds when empty to avoid
  // clobbering a URL the user already edited.
  useEffect(() => {
    if (mediaHeaderType && !headerMediaUrl && template.header_media_url) {
      onHeaderMediaUrlChange(template.header_media_url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaHeaderType, template.header_media_url]);

  const headerMediaError = useMemo<'missing' | 'invalid' | null>(() => {
    if (!mediaHeaderType) return null;
    const value = headerMediaUrl.trim();
    if (!value) return 'missing';
    if (!isValidHttpUrl(value)) return 'invalid';
    return null;
  }, [mediaHeaderType, headerMediaUrl]);

  /**
   * A placeholder is "unmapped" if the user hasn't picked either a
   * static value or a field/custom-field source. Blocks Next until
   * every placeholder has something — otherwise the broadcast would
   * ship with empty strings and confuse recipients.
   */
  const unmappedKeys = useMemo(() => {
    const missing: string[] = [];
    for (const placeholder of placeholders) {
      const key = placeholder.replace(/^\{\{|\}\}$/g, '');
      const mapping = variables[key];
      if (!mapping || !mapping.value?.trim()) {
        missing.push(placeholder);
      }
    }
    return missing;
  }, [placeholders, variables]);

  function updateVariable(key: string, patch: Partial<VariableMapping>) {
    const current = variables[key] ?? { type: 'static' as VariableType, value: '' };
    onUpdate({
      ...variables,
      [key]: { ...current, ...patch },
    });
  }

  /**
   * Upload a header media file and use its public URL for the send.
   * Same bucket + limits as the template form, so anything Meta accepts
   * at approval time can also be swapped in for a broadcast.
   */
  async function handleHeaderMediaFile(file: File, kind: MediaHeaderKind) {
    const spec = MEDIA_HEADER_SPECS[kind];
    if (!spec.mimeTypes.includes(file.type)) {
      toast.error(t('personalize.mediaTypeInvalid', { formats: spec.formats }));
      return;
    }
    const maxBytes = MEDIA_MAX_BYTES_BY_KIND[kind];
    if (file.size > maxBytes) {
      toast.error(
        t('personalize.mediaTooLarge', {
          size: (file.size / 1024 / 1024).toFixed(1),
          max: Math.round(maxBytes / 1024 / 1024),
        }),
      );
      return;
    }
    setUploadingHeader(true);
    try {
      const { publicUrl } = await uploadAccountMedia('chat-media', file);
      onHeaderMediaUrlChange(publicUrl);
      toast.success(t('personalize.uploadSuccess'));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('personalize.uploadFailed'),
      );
    } finally {
      setUploadingHeader(false);
    }
  }

  /**
   * Substitute placeholders using the first real contact where
   * possible. Placeholders keyed by "{{N}}" or "{{name}}" map to
   * variable key "N" / "name".
   */
  const previewText = useMemo(() => {
    const contact = firstContact ?? {
      ...SAMPLE_CONTACT,
      name: t('personalize.sampleName'),
      company: t('personalize.sampleCompany'),
    };
    const customValues = firstContact
      ? firstContactCustomValues
      : new Map<string, string>();

    let text = template.body_text;
    for (const placeholder of placeholders) {
      const key = placeholder.replace(/^\{\{|\}\}$/g, '');
      const mapping = variables[key];
      let replacement = placeholder;

      if (mapping) {
        if (mapping.type === 'static' && mapping.value) {
          replacement = mapping.value;
        } else if (mapping.type === 'field' && mapping.value) {
          const fieldMap: Record<string, string | undefined> = {
            name: contact.name,
            phone: contact.phone,
            email: contact.email,
            company: contact.company,
          };
          replacement = fieldMap[mapping.value] ?? placeholder;
        } else if (mapping.type === 'custom_field' && mapping.value) {
          replacement = customValues.get(mapping.value) || placeholder;
        }
      }
      text = text.replaceAll(placeholder, replacement);
    }
    return text;
  }, [
    template.body_text,
    variables,
    placeholders,
    firstContact,
    firstContactCustomValues,
    t,
  ]);

  const previewLabel = firstContact
    ? firstContact.name || firstContact.phone
    : t('personalize.previewSample');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('personalize.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('personalize.subtitle')}
        </p>
      </div>

      {/* Header media. Always rendered: a template whose local row is
          missing `header_type` (or was synced before header types were
          tracked) can still be sent with media by picking the type
          here. Send-time metadata uses this override. */}
      <div className="rounded-xl border border-border bg-card/50 p-4">
        <div className="mb-3 flex items-center gap-2">
          <ImageIcon className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium text-foreground">
            {t('personalize.headerMedia')}
          </p>
          {mediaHeaderType && (
            <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium uppercase text-primary">
              {mediaHeaderType}
            </span>
          )}
        </div>

        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          {t('personalize.headerTypeLabel')}
        </label>
        <Select
          value={headerType}
          onValueChange={(val) =>
            onHeaderTypeChange((val || 'none') as BroadcastHeaderType)
          }
        >
          <SelectTrigger className="w-full border-border bg-muted text-foreground">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-border bg-popover">
            <SelectItem value="none">{t('personalize.headerTypeNone')}</SelectItem>
            <SelectItem value="image">{t('personalize.headerTypeImage')}</SelectItem>
            <SelectItem value="video">{t('personalize.headerTypeVideo')}</SelectItem>
            <SelectItem value="document">
              {t('personalize.headerTypeDocument')}
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {t('personalize.headerTypeHint')}
        </p>

        <div className="mt-3">
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            {t('personalize.mediaUrl')}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="url"
              value={headerMediaUrl}
              onChange={(e) => onHeaderMediaUrlChange(e.target.value)}
              placeholder={t('personalize.mediaUrlPlaceholder')}
              disabled={!mediaHeaderType}
              className="border-border bg-muted text-foreground placeholder:text-muted-foreground disabled:opacity-60"
            />
            {mediaHeaderType && (
              <>
                <input
                  ref={headerFileRef}
                  type="file"
                  accept={MEDIA_HEADER_SPECS[mediaHeaderType].mimeTypes.join(',')}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleHeaderMediaFile(file, mediaHeaderType);
                    e.target.value = '';
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={uploadingHeader}
                  onClick={() => headerFileRef.current?.click()}
                  className="border-border text-muted-foreground"
                >
                  {uploadingHeader ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  {t('personalize.uploadFile')}
                </Button>
              </>
            )}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {mediaHeaderType
              ? t('personalize.mediaHint', {
                  formats: MEDIA_HEADER_SPECS[mediaHeaderType].formats,
                  max: Math.round(
                    MEDIA_MAX_BYTES_BY_KIND[mediaHeaderType] / 1024 / 1024,
                  ),
                })
              : t('personalize.headerTypeOffHint')}
          </p>
        </div>

        {mediaHeaderType === 'image' &&
          headerMediaError === null &&
          headerMediaUrl.trim() && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={headerMediaUrl.trim()}
              alt={t('personalize.headerPreviewAlt')}
              className="mt-3 max-h-40 rounded-lg border border-border object-contain"
            />
          )}
        {headerMediaError && (
          <p className="mt-1.5 text-xs text-amber-300">
            {headerMediaError === 'missing'
              ? t('personalize.mediaUrlRequired')
              : t('personalize.mediaUrlInvalid')}
          </p>
        )}
      </div>

      {placeholders.length === 0 && !mediaHeaderType ? (
        <div className="rounded-xl border border-border bg-card/50 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {t('personalize.noPreview')}
          </p>
        </div>
      ) : placeholders.length === 0 ? null : (
        <div className="space-y-4">
          {placeholders.map((placeholder) => {
            const key = placeholder.replace(/^\{\{|\}\}$/g, '');
            const mapping = variables[key] ?? { type: 'static', value: '' };

            return (
              <div
                key={placeholder}
                className="rounded-xl border border-border bg-card/50 p-4"
              >
                <div className="mb-3 flex items-center gap-2">
                  <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-mono font-medium text-primary">
                    {placeholder}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      {t('personalize.type')}
                    </label>
                    <Select
                      value={mapping.type}
                      onValueChange={(val) =>
                        updateVariable(key, {
                          type: val as VariableType,
                          value: '',
                        })
                      }
                    >
                      <SelectTrigger className="w-full border-border bg-muted text-foreground">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="border-border bg-popover">
                        <SelectItem value="static">{t('personalize.typeStatic')}</SelectItem>
                        <SelectItem value="field">{t('personalize.typeContact')}</SelectItem>
                        <SelectItem value="custom_field">
                          {t('personalize.typeCustom')}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      {mapping.type === 'static' ? t('personalize.staticValue') : t('personalize.contactField')}
                    </label>
                    {mapping.type === 'static' ? (
                      <Input
                        value={mapping.value}
                        onChange={(e) =>
                          updateVariable(key, { value: e.target.value })
                        }
                        placeholder={t('personalize.enterValue')}
                        className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
                      />
                    ) : mapping.type === 'field' ? (
                      <Select
                        value={mapping.value || undefined}
                        onValueChange={(val) =>
                          updateVariable(key, { value: val || '' })
                        }
                      >
                        <SelectTrigger className="w-full border-border bg-muted text-foreground">
                          <SelectValue placeholder={t('personalize.selectContactField')} />
                        </SelectTrigger>
                        <SelectContent className="border-border bg-popover">
                          {contactFields.map((field) => (
                            <SelectItem key={field.value} value={field.value}>
                              {t(`personalize.fieldMap.${field.labelKey}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Select
                        value={mapping.value || undefined}
                        onValueChange={(val) =>
                          updateVariable(key, { value: val || '' })
                        }
                      >
                        <SelectTrigger className="w-full border-border bg-muted text-foreground">
                          <SelectValue
                            placeholder={
                              loadingFields
                                ? t('personalize.loadingFields')
                                : customFields.length === 0
                                  ? t('personalize.noCustomFields')
                                  : t('personalize.selectCustomField')
                            }
                          />
                        </SelectTrigger>
                        <SelectContent className="border-border bg-popover">
                          {customFields.map((f) => (
                            <SelectItem key={f.id} value={f.id}>
                              {f.field_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Live Preview — rendered as a WhatsApp-style bubble so the user
          sees approximately what the recipient will see. */}
      <div className="rounded-xl border border-border bg-card/50 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Eye className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium text-foreground">{t('personalize.preview')}</p>
          <span className="text-xs text-muted-foreground">({previewLabel})</span>
          {loadingPreview && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          )}
        </div>
        <div className="rounded-lg bg-[#0e1a12] p-3">
          <div className="ml-auto max-w-[85%] rounded-lg bg-primary/30 px-3 py-2 shadow-sm">
            <p className="whitespace-pre-wrap text-sm text-primary">
              {previewText}
            </p>
          </div>
        </div>
      </div>

      {unmappedKeys.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          {t.rich('personalize.unmappedWarning', {
            keys: unmappedKeys.join(', '),
            mono: (chunks) => <span className="font-mono font-semibold">{chunks}</span>,
          })}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          className="border-border text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('back')}
        </Button>
        <Button
          onClick={onNext}
          disabled={unmappedKeys.length > 0 || headerMediaError !== null}
          className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {t('next')}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
