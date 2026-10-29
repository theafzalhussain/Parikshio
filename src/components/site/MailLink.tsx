'use client';

import { useToast } from '@/components/ui/Toast';
import { CONTACT_EMAIL } from '@/lib/site';

type MailLinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>;

/**
 * A mailto: link to the Parikshio support address. Phones always have an app
 * for mailto:, so the link alone opens the email. Many computers have none
 * (Gmail in the browser, no desktop mail app) and the click then seems to do
 * nothing, so with a mouse or trackpad the address is also copied and a short
 * note says so. Without JavaScript it is a plain mailto: link.
 */
export function MailLink({ children, onClick, ...rest }: MailLinkProps) {
  const { push } = useToast();
  return (
    <a
      {...rest}
      href={`mailto:${CONTACT_EMAIL}`}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || !window.matchMedia('(pointer: fine)').matches) return;
        navigator.clipboard?.writeText(CONTACT_EMAIL).then(
          () =>
            push({
              kind: 'info',
              title: 'Opening your email app',
              body: `${CONTACT_EMAIL} is copied too, so you can paste it into Gmail if no app opens.`
            }),
          () => undefined
        );
      }}
    >
      {children ?? CONTACT_EMAIL}
    </a>
  );
}
