import { SVGProps } from "react";

// Ícones de contorno simples (16x16), usados no menu lateral. Mantidos como
// SVG inline (sem dependência externa) para não introduzir mais um pacote
// npm só para meia dúzia de ícones.
function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    />
  );
}

export function IconClipboard(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="6" y="4" width="12" height="17" rx="2" />
      <path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
      <path d="M9 11h6M9 15h6M9 19h3" />
    </Icon>
  );
}

export function IconPrinter(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M7 8V3h10v5" />
      <rect x="4" y="8" width="16" height="8" rx="1.5" />
      <path d="M7 15h10v6H7z" />
    </Icon>
  );
}

export function IconBox(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3.5 7.5 12 3l8.5 4.5L12 12 3.5 7.5Z" />
      <path d="M3.5 7.5V16l8.5 4.5m0-8.5V21m0-8.5 8.5-4.5V16L12 20.5" />
    </Icon>
  );
}

export function IconLayers(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 3 3 8l9 5 9-5-9-5Z" />
      <path d="m3 13 9 5 9-5" />
      <path d="m3 18 9 5 9-5" />
    </Icon>
  );
}

export function IconRoute(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="5" cy="6" r="2.3" />
      <circle cx="19" cy="18" r="2.3" />
      <path d="M7.3 6H15a4 4 0 0 1 4 4v0a4 4 0 0 1-4 4H9a4 4 0 0 0-4 4v0" />
    </Icon>
  );
}

export function IconTruck(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="2" y="7" width="12" height="10" rx="1" />
      <path d="M14 10h4l3 3v4h-7z" />
      <circle cx="7" cy="18.5" r="1.6" />
      <circle cx="17.5" cy="18.5" r="1.6" />
    </Icon>
  );
}

export function IconUsers(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.8 20a6.2 6.2 0 0 1 12.4 0" />
      <path d="M15.5 5.2a3.2 3.2 0 0 1 0 6.2" />
      <path d="M17.3 14.3a6.2 6.2 0 0 1 3.9 5.7" />
    </Icon>
  );
}

export function IconLogout(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon width={13} height={13} {...props}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </Icon>
  );
}

// Usado apenas na barra superior móvel (telemóvel/tablet), para abrir/fechar
// o menu lateral, que nesses ecrãs fica escondido por omissão.
export function IconMenu(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon width={20} height={20} {...props}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </Icon>
  );
}

export function IconClose(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon width={20} height={20} {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Icon>
  );
}

// Usado no menu lateral para "Material em Lacagem" (etapa de acabamento
// junto de fornecedores externos).
export function IconDroplet(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 3s7 7.4 7 12a7 7 0 0 1-14 0c0-4.6 7-12 7-12Z" />
    </Icon>
  );
}

// Usado no menu lateral para "Material a Pedir aos Fornecedores".
export function IconShoppingCart(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="17" cy="20" r="1.4" />
      <path d="M2.5 3h2.2l2.1 11.4a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L20.5 7H6" />
    </Icon>
  );
}
