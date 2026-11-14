```json
{
  "motsDemandes": ["售货员", "斤", "便宜", "可以", "还", "一共", "给", "慢走"],
  "lecon": {
    "identifiant": "au-marche-de-fruits",
    "titre": "Au magasin de fruits",
    "titreCible": "在水果店",
    "transcriptionTitre": "zài shuǐguǒ diàn",
    "sousTitre": "Leçon 5 · adaptée d'un manuel (démonstration)"
  },
  "mots": [
    { "mot": "在", "transcription": "zài", "traduction": "à, dans (lieu)", "nature": "préposition" },
    { "mot": "水果店", "transcription": "shuǐguǒ diàn", "traduction": "magasin de fruits", "nature": "nom" },
    { "mot": "售货员", "transcription": "shòuhuòyuán", "traduction": "vendeur, vendeuse", "nature": "nom" },
    { "mot": "斤", "transcription": "jīn", "traduction": "livre (500 grammes)", "nature": "classificateur" },
    { "mot": "便宜", "transcription": "piányi", "traduction": "bon marché", "nature": "adjectif" },
    { "mot": "可以", "transcription": "kěyǐ", "traduction": "pouvoir", "nature": "verbe" },
    { "mot": "还", "transcription": "hái", "traduction": "encore, en plus", "nature": "adverbe" },
    { "mot": "一共", "transcription": "yígòng", "traduction": "en tout", "nature": "adverbe" },
    { "mot": "贵", "transcription": "guì", "traduction": "cher", "nature": "adjectif" }
  ],
  "scenes": [
    { "id": "acheter-des-fruits", "titre": "Acheter des pommes et un melon d'eau", "lieu": "cour", "personnage": "li",
      "nomAffiche": "售货员", "role": "le vendeur du magasin de fruits", "patience": 3 }
  ],
  "repliques": [
    { "scene": "acheter-des-fruits", "type": "dit", "qui": "li", "texte": "你好！你要买什么？", "traduction": "Bonjour ! Qu'est-ce que tu veux acheter ?" },
    { "scene": "acheter-des-fruits", "type": "choix", "qui": "joueur", "texte": "你好！苹果多少钱一斤？", "traduction": "Bonjour ! Combien coûtent les pommes, la livre ?",
      "consigne": "Salue-le et demande le prix des pommes à la livre.",
      "faux": [
        { "texte": "你好！一斤多少苹果？", "traduction": "(Bonjour ! Une livre, combien de pommes ?)", "pourquoi": "Pour un prix, on dit d'abord 多少钱, puis l'unité : 苹果多少钱一斤？", "erreur": "ordre" },
        { "texte": "你好！苹果是什么？", "traduction": "Bonjour ! Qu'est-ce que c'est, une pomme ?", "pourquoi": "Tu demandes ce qu'est une pomme. Pour le prix : 多少钱.", "erreur": "sens" }
      ] },
    { "scene": "acheter-des-fruits", "type": "dit", "qui": "li", "texte": "苹果五块一斤。", "traduction": "Les pommes, c'est cinq yuans la livre." },
    { "scene": "acheter-des-fruits", "type": "choix", "qui": "joueur", "texte": "太贵了！便宜一点儿，可以吗？", "traduction": "C'est trop cher ! Un peu moins cher, c'est possible ?",
      "consigne": "Tu trouves ça trop cher. Demande un prix un peu plus bas.",
      "faux": [
        { "texte": "太便宜了！便宜一点儿，可以吗？", "traduction": "C'est trop bon marché ! Un peu moins cher, c'est possible ?", "pourquoi": "Si c'est déjà trop bon marché (便宜), pourquoi baisser ? Trop cher : 太贵了.", "erreur": "sens" },
        { "texte": "太贵了！一点儿便宜，可以吗？", "traduction": "(C'est trop cher ! Un peu moins cher, c'est possible ?)", "pourquoi": "一点儿 se place après l'adjectif : 便宜一点儿.", "erreur": "ordre" }
      ] },
    { "scene": "acheter-des-fruits", "type": "dit", "qui": "li", "texte": "好吧，四块五。你要几斤？", "traduction": "Bon, d'accord, quatre yuans cinquante. Tu en veux combien de livres ?" },
    { "scene": "acheter-des-fruits", "type": "choix", "qui": "joueur", "texte": "我要两斤。还要一个西瓜。", "traduction": "J'en veux deux livres. Et aussi un melon d'eau.",
      "consigne": "Prends deux livres de pommes, et aussi un melon d'eau.",
      "faux": [
        { "texte": "我要二斤。还要一个西瓜。", "traduction": "(J'en veux deux livres. Et aussi un melon d'eau.)", "pourquoi": "Devant une unité comme 斤 ou 个, « deux » se dit 两 : 两斤.", "erreur": "nombre" },
        { "texte": "我要两个斤。还要一个西瓜。", "traduction": "(J'en veux deux… livres. Et aussi un melon d'eau.)", "pourquoi": "斤 est déjà une unité : pas de 个 en plus. 两斤.", "erreur": "classificateur" }
      ] },
    { "scene": "acheter-des-fruits", "type": "dit", "qui": "li", "texte": "西瓜十二块。一共二十一块。", "traduction": "Le melon d'eau, c'est douze yuans. Ça fait vingt et un yuans en tout." },
    { "scene": "acheter-des-fruits", "type": "choix", "qui": "joueur", "texte": "给你钱。谢谢！", "traduction": "Voici l'argent. Merci !",
      "consigne": "Donne-lui l'argent et remercie-le.",
      "faux": [
        { "texte": "给你钱。不客气！", "traduction": "Voici l'argent. De rien !", "pourquoi": "不客气 répond à un merci. C'est toi qui remercies : 谢谢！", "erreur": "usage" },
        { "texte": "给我钱。谢谢！", "traduction": "Donne-moi l'argent. Merci !", "pourquoi": "给我钱, c'est « donne-moi l'argent ». C'est toi qui paies : 给你钱.", "erreur": "sens" }
      ] },
    { "scene": "acheter-des-fruits", "type": "dit", "qui": "li", "texte": "不客气。慢走！", "traduction": "De rien. Au revoir, bonne journée !" }
  ],
  "lieuxManquants": [],
  "personnagesManquants": [],
  "notes": [
    "L'élève joue 马丁, l'étudiant client. Le vendeur (售货员) est joué par 李叔叔, le marchand de fruits de la cour : le dessin et le décor (enseigne 水果) conviennent.",
    "Les 9 phrases du dialogue sont reprises telles quelles. L'exercice (« 用多少钱提问 ») n'a pas été ajouté : la scène compte déjà 4 questions.",
    "四块五一斤 × 2 + 12 = 21 : le calcul du manuel est juste.",
    "贵 (dans 太贵了) n'est pas dans le vocabulaire de la leçon : je l'ai ajouté dans « mots »."
  ]
}
```
