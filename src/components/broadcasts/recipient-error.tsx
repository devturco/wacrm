'use client'

import { useTranslations } from 'next-intl'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { explainSendError } from '@/lib/whatsapp/send-error-catalog'

/**
 * Erro de envio de um destinatario. Codigos da Meta viram um titulo
 * traduzido + popover com significado e acao; erros locais (ja
 * traduzidos no momento do envio) aparecem como vieram.
 */
export function RecipientError({ raw }: { raw?: string | null }) {
  const t = useTranslations('Broadcasts.errors')
  const info = explainSendError(raw)

  if (!info) return <span className="text-muted-foreground">-</span>

  // Sem codigo: texto que o proprio app gravou (ex.: "Telefone
  // invalido"), ja legivel — nao ha o que explicar.
  if (info.code === null) {
    return (
      <span className="block truncate" title={info.raw}>
        {info.raw}
      </span>
    )
  }

  return (
    <div className="flex flex-col gap-0.5">
      <span className="block truncate" title={info.raw}>
        {t(`kinds.${info.kind}.title`)}
      </span>
      <Popover>
        <PopoverTrigger className="w-fit text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
          {t('viewDetails')}
        </PopoverTrigger>
        <PopoverContent className="w-80" side="top" align="start">
          <PopoverHeader>
            <PopoverTitle>{t(`kinds.${info.kind}.title`)}</PopoverTitle>
            <PopoverDescription>
              {t('metaCode', { code: info.code })}
            </PopoverDescription>
          </PopoverHeader>
          <p className="text-xs text-foreground">
            {t(`kinds.${info.kind}.meaning`)}
          </p>
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] font-medium text-foreground">
              {t('whatToDo')}
            </span>
            <p className="text-xs text-muted-foreground">
              {t(`kinds.${info.kind}.action`)}
            </p>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] font-medium text-foreground">
              {t('originalMessage')}
            </span>
            <p className="max-h-24 overflow-y-auto break-words rounded bg-muted/50 p-1.5 font-mono text-[11px] text-muted-foreground">
              {info.raw}
            </p>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}