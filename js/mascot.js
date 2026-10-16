export const FALLBACK = "./assets/pushin/fallback.svg";

export const STICKERS = [
  { title: "Пушин", src: "./assets/pushin/01-sit.gif", need: 3 },
  { title: "Печенье", src: "./assets/pushin/02-cookie.gif", need: 6 },
  { title: "Сон", src: "./assets/pushin/03-sleep.gif", need: 9 },
  { title: "Пончик", src: "./assets/pushin/04-donut.gif", need: 12 },
  { title: "Коробка", src: "./assets/pushin/05-box.gif", need: 15 },
  { title: "Пицца", src: "./assets/pushin/06-pizza.gif", need: 18 },
  { title: "Письмо", src: "./assets/pushin/07-write.gif", need: 21 },
  { title: "Какао", src: "./assets/pushin/08-cocoa.gif", need: 24 },
  { title: "Праздник", src: "./assets/pushin/09-party.gif", need: 27 },
  { title: "Торт", src: "./assets/pushin/10-cake.gif", need: 30 },
  { title: "Шляпа", src: "./assets/pushin/11-hat.gif", need: 33 },
  { title: "Кекс", src: "./assets/pushin/12-cupcake.gif", need: 36 },
  { title: "Герой", src: "./assets/pushin/13-hero.gif", need: 39 },
];

export function stickerUnlocked(index, stars, solved) {
  if (index === 0) return solved >= 1;
  return stars >= STICKERS[index].need;
}

export function unlockedStickers(stars, solved = 0) {
  return STICKERS.filter((_, index) => stickerUnlocked(index, stars, solved));
}

export function stickerLockText(index) {
  if (index === 0) return "Первое задание";
  const count = STICKERS[index].need;
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word = mod10 === 1 && mod100 !== 11
    ? "звезда"
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
      ? "звезды"
      : "звёзд";
  return `${count} ${word}`;
}

export function reactionFor({ change, star } = {}) {
  if (star && change === "up") return "Пушин ставит звезду и открывает следующий уровень.";
  if (star) return "Пушин ставит звезду. Этот уровень держится.";
  if (change === "up") return "Пушин открывает следующий уровень.";
  if (change === "down") return "Пушин рядом. Дальше примеры чуть спокойнее.";
  return "Пушин доволен: занятие сделано.";
}
