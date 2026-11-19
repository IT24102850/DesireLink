// Transactional email copy in English, Sinhala and Tamil.
// Have a native speaker proofread si/ta before launch.

const T = {
  en: {
    footer: "DesireLink · verified adults 18+ only. You received this because of activity on your account.",
    code: {
      subject: "Your DesireLink confirmation code",
      lines: ({ code }) => [`Your confirmation code is: ${code}`, "It expires in 15 minutes. If you did not create an account, ignore this email."],
    },
    reset: {
      subject: "Reset your DesireLink password",
      lines: ({ code }) => [`Your password reset code is: ${code}`, "It expires in 15 minutes. If you did not ask for this, you can ignore this email."],
    },
    invite: {
      subject: "Activate your DesireLink publisher account",
      lines: () => ["An administrator created a DesireLink publisher account for this email address at your request.", "To activate it, choose a password and accept the terms. The link is valid for 72 hours.", "If you did not ask for this, ignore this email. The account stays inactive and nothing is published."],
      cta: "Activate account",
    },
    verificationApproved: {
      subject: "Your identity is verified",
      lines: () => ["Your ID verification was approved. Your ID photos have been permanently deleted.", "You can now post ads."],
      cta: "Post an ad",
    },
    verificationRejected: {
      subject: "Your verification needs attention",
      lines: ({ reason }) => ["Your ID verification was not approved.", `Reason: ${reason}`, "You can correct this and submit again."],
      cta: "Resubmit verification",
    },
    adApproved: {
      subject: "Your ad is live",
      lines: ({ title }) => [`Your ad "${title}" was approved and is now visible for 30 days.`],
      cta: "View my ads",
    },
    adRejected: {
      subject: "Your ad was not approved",
      lines: ({ title, reason }) => [`Your ad "${title}" was not approved.`, `Reason: ${reason}`, "Edit the ad to fix it and it will be reviewed again."],
      cta: "View my ads",
    },
    adRemoved: {
      subject: "Your ad was removed",
      lines: ({ title, reason }) => [`Your ad "${title}" was removed by a moderator.`, reason ? `Reason: ${reason}` : ""].filter(Boolean),
      cta: "View my ads",
    },
  },

  si: {
    footer: "DesireLink · සත්‍යාපිත වැඩිහිටියන් (18+) සඳහා පමණි. ඔබේ ගිණුමේ ක්‍රියාකාරකමක් නිසා මෙම ලිපිය ලැබුණි.",
    code: {
      subject: "ඔබේ DesireLink තහවුරු කිරීමේ කේතය",
      lines: ({ code }) => [`ඔබේ තහවුරු කිරීමේ කේතය: ${code}`, "එය මිනිත්තු 15කින් කල් ඉකුත් වේ. ඔබ ගිණුමක් නොසෑදුවේ නම්, මෙම ලිපිය නොසලකා හරින්න."],
    },
    reset: {
      subject: "ඔබේ DesireLink මුරපදය යළි සකසන්න",
      lines: ({ code }) => [`ඔබේ මුරපදය යළි සැකසීමේ කේතය: ${code}`, "එය මිනිත්තු 15කින් කල් ඉකුත් වේ. ඔබ මෙය ඉල්ලුවේ නැත්නම්, නොසලකා හරින්න."],
    },
    invite: {
      subject: "ඔබේ DesireLink පළකරු ගිණුම සක්‍රීය කරන්න",
      lines: () => ["ඔබේ ඉල්ලීම පරිදි පරිපාලකයෙකු මෙම විද්‍යුත් තැපැල් ලිපිනය සඳහා DesireLink පළකරු ගිණුමක් සාදා ඇත.", "එය සක්‍රීය කිරීමට, මුරපදයක් තෝරා නියමයන් පිළිගන්න. මෙම සබැඳිය පැය 72ක් වලංගුයි.", "ඔබ මෙය ඉල්ලුවේ නැත්නම්, මෙම ලිපිය නොසලකා හරින්න. ගිණුම අක්‍රීයව පවතින අතර කිසිවක් පළ නොවේ."],
      cta: "ගිණුම සක්‍රීය කරන්න",
    },
    verificationApproved: {
      subject: "ඔබේ අනන්‍යතාව සත්‍යාපනය විය",
      lines: () => ["ඔබේ හැඳුනුම්පත් සත්‍යාපනය අනුමත විය. ඔබේ හැඳුනුම්පත් ඡායාරූප ස්ථිරවම මකා දමා ඇත.", "දැන් ඔබට දැන්වීම් පළ කළ හැක."],
      cta: "දැන්වීමක් පළ කරන්න",
    },
    verificationRejected: {
      subject: "ඔබේ සත්‍යාපනය සඳහා අවධානය අවශ්‍යයි",
      lines: ({ reason }) => ["ඔබේ හැඳුනුම්පත් සත්‍යාපනය අනුමත නොවීය.", `හේතුව: ${reason}`, "නිවැරදි කර නැවත යැවිය හැක."],
      cta: "නැවත යවන්න",
    },
    adApproved: {
      subject: "ඔබේ දැන්වීම දැන් සජීවීයි",
      lines: ({ title }) => [`ඔබේ "${title}" දැන්වීම අනුමත වූ අතර දින 30ක් දිස්වේ.`],
      cta: "මගේ දැන්වීම්",
    },
    adRejected: {
      subject: "ඔබේ දැන්වීම අනුමත නොවීය",
      lines: ({ title, reason }) => [`ඔබේ "${title}" දැන්වීම අනුමත නොවීය.`, `හේතුව: ${reason}`, "දැන්වීම සංස්කරණය කළ විට එය නැවත සමාලෝචනය වේ."],
      cta: "මගේ දැන්වීම්",
    },
    adRemoved: {
      subject: "ඔබේ දැන්වීම ඉවත් කරන ලදී",
      lines: ({ title, reason }) => [`ඔබේ "${title}" දැන්වීම පරිපාලකයෙකු විසින් ඉවත් කරන ලදී.`, reason ? `හේතුව: ${reason}` : ""].filter(Boolean),
      cta: "මගේ දැන්වීම්",
    },
  },

  ta: {
    footer: "DesireLink · சரிபார்க்கப்பட்ட 18+ பெரியவர்களுக்கு மட்டும். உங்கள் கணக்கின் செயல்பாட்டால் இந்த மின்னஞ்சல் அனுப்பப்பட்டது.",
    code: {
      subject: "உங்கள் DesireLink உறுதிப்படுத்தல் குறியீடு",
      lines: ({ code }) => [`உங்கள் உறுதிப்படுத்தல் குறியீடு: ${code}`, "இது 15 நிமிடங்களில் காலாவதியாகும். நீங்கள் கணக்கை உருவாக்கவில்லை என்றால், இதைப் புறக்கணிக்கவும்."],
    },
    reset: {
      subject: "உங்கள் DesireLink கடவுச்சொல்லை மீட்டமைக்கவும்",
      lines: ({ code }) => [`உங்கள் கடவுச்சொல் மீட்டமைப்பு குறியீடு: ${code}`, "இது 15 நிமிடங்களில் காலாவதியாகும். நீங்கள் கோரவில்லை என்றால், புறக்கணிக்கவும்."],
    },
    invite: {
      subject: "உங்கள் DesireLink வெளியீட்டாளர் கணக்கைச் செயல்படுத்துங்கள்",
      lines: () => ["உங்கள் கோரிக்கையின்படி ஒரு நிர்வாகி இந்த மின்னஞ்சல் முகவரிக்கு DesireLink வெளியீட்டாளர் கணக்கை உருவாக்கியுள்ளார்.", "செயல்படுத்த, கடவுச்சொல்லைத் தேர்ந்தெடுத்து விதிமுறைகளை ஏற்கவும். இந்த இணைப்பு 72 மணி நேரம் செல்லுபடியாகும்.", "நீங்கள் இதைக் கோரவில்லை என்றால், இந்த மின்னஞ்சலைப் புறக்கணிக்கவும். கணக்கு செயலற்றதாகவே இருக்கும், எதுவும் வெளியிடப்படாது."],
      cta: "கணக்கைச் செயல்படுத்து",
    },
    verificationApproved: {
      subject: "உங்கள் அடையாளம் சரிபார்க்கப்பட்டது",
      lines: () => ["உங்கள் அடையாள சரிபார்ப்பு அங்கீகரிக்கப்பட்டது. உங்கள் அடையாள அட்டை படங்கள் நிரந்தரமாக நீக்கப்பட்டன.", "இப்போது நீங்கள் விளம்பரங்களை இடலாம்."],
      cta: "விளம்பரம் இடு",
    },
    verificationRejected: {
      subject: "உங்கள் சரிபார்ப்பில் கவனம் தேவை",
      lines: ({ reason }) => ["உங்கள் அடையாள சரிபார்ப்பு அங்கீகரிக்கப்படவில்லை.", `காரணம்: ${reason}`, "திருத்தி மீண்டும் சமர்ப்பிக்கலாம்."],
      cta: "மீண்டும் சமர்ப்பி",
    },
    adApproved: {
      subject: "உங்கள் விளம்பரம் நேரலையில் உள்ளது",
      lines: ({ title }) => [`உங்கள் "${title}" விளம்பரம் அங்கீகரிக்கப்பட்டு 30 நாட்கள் காட்டப்படும்.`],
      cta: "என் விளம்பரங்கள்",
    },
    adRejected: {
      subject: "உங்கள் விளம்பரம் அங்கீகரிக்கப்படவில்லை",
      lines: ({ title, reason }) => [`உங்கள் "${title}" விளம்பரம் அங்கீகரிக்கப்படவில்லை.`, `காரணம்: ${reason}`, "திருத்தினால் மீண்டும் மதிப்பாய்வு செய்யப்படும்."],
      cta: "என் விளம்பரங்கள்",
    },
    adRemoved: {
      subject: "உங்கள் விளம்பரம் நீக்கப்பட்டது",
      lines: ({ title, reason }) => [`உங்கள் "${title}" விளம்பரம் நிர்வாகியால் நீக்கப்பட்டது.`, reason ? `காரணம்: ${reason}` : ""].filter(Boolean),
      cta: "என் விளம்பரங்கள்",
    },
  },
};

export const emailText = (lang) => T[lang] || T.en;
