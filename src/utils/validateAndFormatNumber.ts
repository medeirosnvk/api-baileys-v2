export const normalizeBrazilianNumber = async (number: string) => {
  // remove tudo que não for número
  let cleaned = number.replace(/\D/g, "");

  // garante que começa com DDI do Brasil
  if (!cleaned.startsWith("55")) {
    cleaned = "55" + cleaned;
  }

  // remove o nono dígito quando for número móvel com 13 dígitos
  // Exemplo: 5551995725700 -> 555195725700
  if (cleaned.length === 13 && cleaned.startsWith("55")) {
    const ddd = cleaned.slice(2, 4);
    const firstDigitAfterDDD = cleaned.charAt(4);
    if (firstDigitAfterDDD === "9") {
      cleaned = "55" + ddd + cleaned.slice(5);
    }
  }

  return cleaned;
};
