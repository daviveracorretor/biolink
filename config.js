/* Edite este arquivo para configurar seus canais e serviços. Não coloque chaves secretas aqui. */
window.SITE_CONFIG = {
  whatsapp: "5545998301970", // DDI + DDD + número
  instagram: "https://www.instagram.com/davi_veraa/",
  profileImage: "assets/davi-vera.jpg", // Foto de perfil pública do site
  categories: ["Lançamentos", "Minha Casa Minha Vida", "Terrenos", "Apartamentos prontos", "Casas"],
  spotlight: { visible: true, title: "Faça sua Simulação de Crédito", description: "Descubra o valor do seu subsídio e as condições que fazem sentido para você.", button: "Simular no WhatsApp" },
  supabase: { url: "https://cqntvhgsjxaztbjubkvj.supabase.co", anonKey: "sb_publishable_mCNaNgYTmdvq9qN3IFP_WA_T2AWP2AM", adminUserId: "d4f4490d-96f2-406b-bced-6f0a27d31116", table: "properties", bucket: "property-photos" },
  // Endpoint opcional de analytics que aceite POST JSON: { event, property_id, timestamp }.
  analyticsEndpoint: ""
};
