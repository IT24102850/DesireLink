// Sri Lanka's 25 districts with English / Sinhala / Tamil names.
export const DISTRICTS = [
  { id: 1, en: "Colombo", si: "කොළඹ", ta: "கொழும்பு" },
  { id: 2, en: "Gampaha", si: "ගම්පහ", ta: "கம்பஹா" },
  { id: 3, en: "Kalutara", si: "කළුතර", ta: "களுத்துறை" },
  { id: 4, en: "Kandy", si: "මහනුවර", ta: "கண்டி" },
  { id: 5, en: "Matale", si: "මාතලේ", ta: "மாத்தளை" },
  { id: 6, en: "Nuwara Eliya", si: "නුවරඑළිය", ta: "நுவரெலியா" },
  { id: 7, en: "Galle", si: "ගාල්ල", ta: "காலி" },
  { id: 8, en: "Matara", si: "මාතර", ta: "மாத்தறை" },
  { id: 9, en: "Hambantota", si: "හම්බන්තොට", ta: "அம்பாந்தோட்டை" },
  { id: 10, en: "Jaffna", si: "යාපනය", ta: "யாழ்ப்பாணம்" },
  { id: 11, en: "Kilinochchi", si: "කිලිනොච්චි", ta: "கிளிநொச்சி" },
  { id: 12, en: "Mannar", si: "මන්නාරම", ta: "மன்னார்" },
  { id: 13, en: "Vavuniya", si: "වවුනියාව", ta: "வவுனியா" },
  { id: 14, en: "Mullaitivu", si: "මුලතිව්", ta: "முல்லைத்தீவு" },
  { id: 15, en: "Batticaloa", si: "මඩකලපුව", ta: "மட்டக்களப்பு" },
  { id: 16, en: "Ampara", si: "අම්පාර", ta: "அம்பாறை" },
  { id: 17, en: "Trincomalee", si: "ත්‍රිකුණාමලය", ta: "திருகோணமலை" },
  { id: 18, en: "Kurunegala", si: "කුරුණෑගල", ta: "குருநாகல்" },
  { id: 19, en: "Puttalam", si: "පුත්තලම", ta: "புத்தளம்" },
  { id: 20, en: "Anuradhapura", si: "අනුරාධපුර", ta: "அனுராதபுரம்" },
  { id: 21, en: "Polonnaruwa", si: "පොළොන්නරුව", ta: "பொலன்னறுவை" },
  { id: 22, en: "Badulla", si: "බදුල්ල", ta: "பதுளை" },
  { id: 23, en: "Monaragala", si: "මොණරාගල", ta: "மொணராகலை" },
  { id: 24, en: "Ratnapura", si: "රත්නපුර", ta: "இரத்தினபுரி" },
  { id: 25, en: "Kegalle", si: "කෑගල්ල", ta: "கேகாலை" },
];

export const districtName = (id, lang) => {
  const d = DISTRICTS.find((x) => x.id === Number(id));
  return d ? d[lang] || d.en : "";
};
