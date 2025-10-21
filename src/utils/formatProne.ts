export function formatPhoneNumber(phoneNumber: string) {
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
