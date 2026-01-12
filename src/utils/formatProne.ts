export function formatToPhoneNumber(phoneNumber: string): string {
  console.log("Limpando TO number:", phoneNumber);

  if (!phoneNumber || typeof phoneNumber !== "string") {
    console.error("Phone number inválido");
    return "";
  }

  let onlyNumbers = phoneNumber.replace(/\D/g, "");

  // remove código do país 55
  if (onlyNumbers.startsWith("55")) {
    onlyNumbers = onlyNumbers.slice(2);
  }

  // remove DDD
  if (onlyNumbers.length >= 10) {
    onlyNumbers = onlyNumbers.slice(2);
  }

  // remove nono dígito se existir
  if (onlyNumbers.length === 9 && onlyNumbers.startsWith("9")) {
    onlyNumbers = onlyNumbers.slice(1);
  }

  return onlyNumbers.slice(0, 8);
}

export function formatFromPhoneNumber(phoneNumber: string) {
  console.log("Limpando FROM number:", phoneNumber);

  if (!phoneNumber) {
    console.error("Phone number is undefined or null");
    return ""; // Ou outra ação apropriada, dependendo do seu caso
  }

  // Realizar formatação apenas se phoneNumber for uma string
  if (typeof phoneNumber === "string") {
    return phoneNumber.replace(/[^\d]/g, "").replace(/^.*?(\d{8})$/, "$1");
  } else {
    console.error("Phone number is not a string");
    return ""; // Ou outra ação apropriada, dependendo do seu caso
  }
}

export function cleanNumber(jid: string = ""): string {
  return jid.replace(/:\d+(?=@)/, ""); // remove ":números" apenas antes de "@"
}
