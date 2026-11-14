Voici le brouillon de la leçon.

```json
{
  "motsDemandes": ["公司", "经理", "价格", "便宜", "贵", "太", "可以", "打折", "一共", "买", "卖", "觉得", "有点儿", "最", "还是", "怎么样", "同意", "下次", "已经", "欢迎"],
  "lecon": {
    "identifiant": "negocier-un-prix",
    "titre": "Négocier un prix",
    "titreCible": "讲价",
    "transcriptionTitre": "jiǎng jià",
    "sousTitre": "Rendez-vous d'affaires · HSK 2"
  },
  "mots": [
    { "mot": "讲价", "transcription": "jiǎng jià", "traduction": "marchander, négocier le prix", "nature": "verbe" },
    { "mot": "公司", "transcription": "gōngsī", "traduction": "société, entreprise", "nature": "nom" },
    { "mot": "经理", "transcription": "jīnglǐ", "traduction": "directeur, responsable", "nature": "nom" },
    { "mot": "价格", "transcription": "jiàgé", "traduction": "prix", "nature": "nom" },
    { "mot": "便宜", "transcription": "piányi", "traduction": "bon marché, pas cher", "nature": "adjectif" },
    { "mot": "贵", "transcription": "guì", "traduction": "cher", "nature": "adjectif" },
    { "mot": "可以", "transcription": "kěyǐ", "traduction": "pouvoir (avoir la possibilité)", "nature": "verbe" },
    { "mot": "打折", "transcription": "dǎ zhé", "traduction": "faire une remise", "nature": "verbe" },
    { "mot": "一共", "transcription": "yígòng", "traduction": "en tout, au total", "nature": "adverbe" },
    { "mot": "觉得", "transcription": "juéde", "traduction": "trouver, penser (avis)", "nature": "verbe" },
    { "mot": "有点儿", "transcription": "yǒudiǎnr", "traduction": "un peu (devant un adjectif, souvent négatif)", "nature": "adverbe" },
    { "mot": "最", "transcription": "zuì", "traduction": "le plus", "nature": "adverbe" },
    { "mot": "还是", "transcription": "háishi", "traduction": "ou bien (dans une question)", "nature": "conjonction" },
    { "mot": "怎么样", "transcription": "zěnmeyàng", "traduction": "comment ? qu'en pensez-vous ?", "nature": "pronom" },
    { "mot": "同意", "transcription": "tóngyì", "traduction": "être d'accord, accepter", "nature": "verbe" },
    { "mot": "已经", "transcription": "yǐjīng", "traduction": "déjà", "nature": "adverbe" }
  ],
  "scenes": [
    { "id": "rendez-vous", "titre": "Le rendez-vous avec le directeur", "lieu": "cour", "personnage": "bai",
      "nomAffiche": "张经理", "role": "le directeur d'une fabrique de tasses", "patience": 3 },
    { "id": "accord", "titre": "Trouver un accord", "lieu": "cour", "personnage": "bai",
      "nomAffiche": "张经理", "role": "le directeur d'une fabrique de tasses", "patience": 3 }
  ],
  "repliques": [
    { "scene": "rendez-vous", "type": "dit", "qui": "bai", "texte": "欢迎欢迎！坐吧。", "traduction": "Bienvenue, bienvenue ! Asseyez-vous." },
    { "scene": "rendez-vous", "type": "dit", "qui": "joueur", "texte": "经理，您好！", "traduction": "Bonjour, monsieur le directeur !" },
    { "scene": "rendez-vous", "type": "dit", "qui": "bai", "texte": "你喝绿茶还是红茶？", "traduction": "Vous prenez du thé vert ou du thé noir ?" },
    { "scene": "rendez-vous", "type": "choix", "qui": "joueur", "texte": "绿茶，谢谢！", "traduction": "Du thé vert, merci !",
      "consigne": "Il te propose du thé. Choisis le thé vert.",
      "faux": [
        { "texte": "绿茶还是红茶。", "traduction": "Thé vert ou thé noir.", "pourquoi": "还是 sert à poser la question « ou bien ? ». Pour répondre, choisis simplement : 绿茶，谢谢！", "erreur": "grammaire" },
        { "texte": "红茶，谢谢！", "traduction": "Du thé noir, merci !", "pourquoi": "红茶, le « thé rouge », c'est le thé noir. Le thé vert : 绿茶.", "erreur": "sens" }
      ] },
    { "scene": "rendez-vous", "type": "dit", "qui": "bai", "texte": "你们公司想买什么？", "traduction": "Que souhaite acheter votre société ?" },
    { "scene": "rendez-vous", "type": "choix", "qui": "joueur", "texte": "我们公司想买茶杯。", "traduction": "Notre société voudrait acheter des tasses à thé.",
      "consigne": "Dis que ta société veut acheter des tasses à thé.",
      "faux": [
        { "texte": "我们公司想卖茶杯。", "traduction": "Notre société voudrait vendre des tasses à thé.", "pourquoi": "卖 (mài, 4e ton) veut dire vendre. Acheter, c'est 买 (mǎi, 3e ton) : seul le ton change !", "erreur": "son" },
        { "texte": "我们经理想买茶杯。", "traduction": "Notre directeur voudrait acheter des tasses à thé.", "pourquoi": "经理, c'est le directeur. Ici, c'est ta société qui achète : 我们公司.", "erreur": "sens" }
      ] },
    { "scene": "rendez-vous", "type": "dit", "qui": "bai", "texte": "我们公司卖最好的茶杯。一个十块。", "traduction": "Notre société vend les meilleures tasses. Dix yuans pièce." },
    { "scene": "rendez-vous", "type": "choix", "qui": "joueur", "texte": "太贵了！可以便宜一点儿吗？", "traduction": "C'est trop cher ! Vous pouvez faire un peu moins cher ?",
      "consigne": "Tu trouves ça trop cher. Demande-lui de baisser le prix.",
      "faux": [
        { "texte": "太便宜了！可以贵一点儿吗？", "traduction": "C'est trop bon marché ! Vous pouvez faire un peu plus cher ?", "pourquoi": "便宜 veut dire « pas cher » et 贵 « cher » : tu as inversé les deux.", "erreur": "sens" },
        { "texte": "太贵了！你觉得怎么样？", "traduction": "C'est trop cher ! Qu'en pensez-vous ?", "pourquoi": "你觉得怎么样 demande son avis, sans rien demander. Pour obtenir une baisse : 可以便宜一点儿吗？", "erreur": "usage" }
      ] },
    { "scene": "rendez-vous", "type": "dit", "qui": "bai", "texte": "我觉得价格不贵。你们买多少个？", "traduction": "Je trouve que le prix n'est pas élevé. Vous en prenez combien ?" },
    { "scene": "rendez-vous", "type": "choix", "qui": "joueur", "texte": "我们一共买三百个。", "traduction": "Nous en achetons trois cents en tout.",
      "consigne": "Annonce que vous en achetez trois cents en tout.",
      "faux": [
        { "texte": "我们一共卖三百个。", "traduction": "Nous en vendons trois cents en tout.", "pourquoi": "卖 (mài) = vendre. Acheter : 买 (mǎi), au 3e ton.", "erreur": "son" },
        { "texte": "我们一共买三百。", "traduction": "(Nous en achetons trois cents, sans compter les tasses.)", "pourquoi": "Il demande 多少个 : réponds avec le classificateur, 三百个.", "erreur": "classificateur" }
      ] },
    { "scene": "rendez-vous", "type": "dit", "qui": "bai", "texte": "三百个？我想一下。", "traduction": "Trois cents ? Laissez-moi réfléchir." },

    { "scene": "accord", "type": "dit", "qui": "bai", "texte": "三百个茶杯，我可以打折。九块一个，怎么样？", "traduction": "Pour trois cents tasses, je peux vous faire une remise. Neuf yuans pièce, ça vous va ?" },
    { "scene": "accord", "type": "choix", "qui": "joueur", "texte": "有点儿贵。八块可以吗？", "traduction": "C'est un peu cher. Huit yuans, c'est possible ?",
      "consigne": "C'est encore un peu cher pour toi. Propose huit yuans.",
      "faux": [
        { "texte": "一点儿贵。八块可以吗？", "traduction": "(Un peu cher. Huit yuans, c'est possible ?)", "pourquoi": "Devant un adjectif, « un peu (trop) » se dit 有点儿 : 有点儿贵. 一点儿 se met après : 便宜一点儿.", "erreur": "grammaire" },
        { "texte": "有点儿便宜。八块可以吗？", "traduction": "C'est un peu bon marché. Huit yuans, c'est possible ?", "pourquoi": "Si c'est bon marché (便宜), pourquoi baisser ? Tu trouves ça cher : 有点儿贵.", "erreur": "sens" }
      ] },
    { "scene": "accord", "type": "dit", "qui": "bai", "texte": "八块？太便宜了！我已经打折了。", "traduction": "Huit yuans ? C'est bien trop peu ! J'ai déjà fait une remise." },
    { "scene": "accord", "type": "choix", "qui": "joueur", "texte": "八块五，怎么样？", "traduction": "Huit yuans cinquante, ça vous va ?",
      "consigne": "Coupe la poire en deux : propose 8,50 yuans.",
      "faux": [
        { "texte": "五块八，怎么样？", "traduction": "Cinq yuans quatre-vingts, ça vous va ?", "pourquoi": "Le chiffre des yuans vient d'abord : 8,50 yuans se dit 八块五.", "erreur": "nombre" }
      ] },
    { "scene": "accord", "type": "dit", "qui": "bai", "texte": "好，我同意！一共两千五百五十块。", "traduction": "Bon, d'accord ! Ça fait 2 550 yuans en tout." },
    { "scene": "accord", "type": "choix", "qui": "joueur", "texte": "谢谢！下次我们公司再买。", "traduction": "Merci ! La prochaine fois, notre société en rachètera.",
      "consigne": "Remercie-le et dis que ta société en rachètera la prochaine fois.",
      "faux": [
        { "texte": "谢谢！下次我们公司再卖。", "traduction": "Merci ! La prochaine fois, notre société en revendra.", "pourquoi": "卖 (mài) = vendre. Ta société achète : 买 (mǎi).", "erreur": "son" },
        { "texte": "谢谢！下次我们公司再打折。", "traduction": "Merci ! La prochaine fois, notre société refera une remise.", "pourquoi": "C'est le vendeur qui fait une remise (打折). Toi, tu achètes : 再买.", "erreur": "sens" }
      ] },
    { "scene": "accord", "type": "dit", "qui": "bai", "texte": "欢迎下次再来！", "traduction": "Revenez quand vous voulez !" }
  ],
  "lieuxManquants": [
    { "souhaite": "les bureaux d'une entreprise, dans un immeuble moderne de Shanghai", "remplace": "cour",
      "pourquoi": "Le rendez-vous a lieu au salon de thé de la cour : à Shanghai, on négocie volontiers autour d'un thé." }
  ],
  "notes": [
    "Personnage : le dessin du bouquiniste (白老师) joue le directeur. Un dessin d'homme d'affaires serait plus crédible.",
    "« 经理，您好！ » : on dit plus souvent « 张经理，您好！ ». J'ai retiré le nom de famille pour que l'élève voie 经理 comme un mot à part entière.",
    "« 太贵了！你觉得怎么样？ » comme mauvaise réponse : discutable, un locuteur pourrait l'employer. À remplacer si elle vous paraît acceptable.",
    "Prix à l'oral (九块一个, 八块五) : vérifier que 八块五 = 8,50 yuans est accessible au niveau HSK 2.",
    "讲价 (titre) est un mot hors de la liste demandée ; 砍价 est plus familier."
  ]
}
```
