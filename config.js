/* Edite este arquivo para configurar seus canais e serviços. Não coloque chaves secretas aqui. */
window.SITE_CONFIG = {
  whatsapp: "5545998301970", // DDI + DDD + número
  instagram: "https://www.instagram.com/davi_veraa/",
  profileImage: "", // Caminho relativo, ex.: assets/davi-vera.jpg
  categories: ["Lançamentos", "Minha Casa Minha Vida", "Apartamentos prontos", "Casas", "Terrenos"],
  spotlight: { visible: true, title: "Seu imóvel começa com uma boa conversa.", description: "Descubra possibilidades de subsídio e financiamento para conquistar seu imóvel.", button: "Fazer simulação" },
  supabase: { url: "", anonKey: "", adminUserId: "", table: "properties", bucket: "property-photos" },
  // Endpoint opcional de analytics que aceite POST JSON: { event, property_id, timestamp }.
  analyticsEndpoint: ""
};
