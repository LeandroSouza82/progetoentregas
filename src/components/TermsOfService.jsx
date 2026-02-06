import React from 'react';
import './TermsOfService.css';

const TermsOfService = () => {
    return (
        <div className="terms-container">
            <div className="terms-content">
                <h1>Termos de Serviço - V10 Delivery</h1>
                <p className="last-update"><strong>Última atualização:</strong> 6 de fevereiro de 2026</p>

                <section>
                    <h2>1. Aceitação dos Termos</h2>
                    <p>Ao utilizar o V10 Delivery, você concorda com estes Termos de Serviço. Se não concordar, não utilize a plataforma.</p>
                </section>

                <section>
                    <h2>2. Uso do Serviço</h2>
                    <p>O V10 Delivery é uma plataforma de gerenciamento de entregas. Você se compromete a:</p>
                    <ul>
                        <li>Fornecer informações verdadeiras e precisas</li>
                        <li>Manter a confidencialidade de sua conta</li>
                        <li>Não utilizar o serviço para fins ilegais</li>
                        <li>Respeitar as diretrizes operacionais estabelecidas</li>
                    </ul>
                </section>

                <section>
                    <h2>3. Responsabilidades</h2>
                    <p><strong>Do Usuário:</strong></p>
                    <ul>
                        <li>Garantir informações corretas de entrega</li>
                        <li>Manter horários e compromissos agendados</li>
                        <li>Tratar motoristas e equipe com respeito</li>
                    </ul>
                    <p><strong>Do V10 Delivery:</strong></p>
                    <ul>
                        <li>Fornecer plataforma estável e segura</li>
                        <li>Manter privacidade dos dados</li>
                        <li>Garantir comunicação eficiente entre partes</li>
                    </ul>
                </section>

                <section>
                    <h2>4. Limitação de Responsabilidade</h2>
                    <p>O V10 Delivery não se responsabiliza por:</p>
                    <ul>
                        <li>Atrasos causados por fatores externos (trânsito, clima)</li>
                        <li>Danos a mercadorias mal embaladas</li>
                        <li>Informações incorretas fornecidas pelo usuário</li>
                    </ul>
                </section>

                <section>
                    <h2>5. Cancelamento</h2>
                    <p>Reservamo-nos o direito de suspender ou cancelar contas que violem estes termos sem aviso prévio.</p>
                </section>

                <section>
                    <h2>6. Alterações</h2>
                    <p>Podemos modificar estes termos a qualquer momento. Alterações significativas serão comunicadas aos usuários.</p>
                </section>

                <div className="back-link">
                    <a href="/">← Voltar para a página inicial</a>
                </div>
            </div>
        </div>
    );
};

export default TermsOfService;
