import { executeQuery } from "../config/database/dbConfig.js";
import requests from "../utils/requests.js";
import utils from "../utils/utils.js";
import fs from "fs";
import path from "path";
import { WhatsAppService } from "./whatsappServices.js";
import { Logger } from "../utils/logger.js";
import { formatPhoneNumber } from "../utils/formatProne.js";

// Tipos básicos para melhor tipagem
type PhoneNumber = string | number;
type TicketId = string | number | null;

interface UserState {
  currentState: string;
  credor?: CredorData;
  data?: {
    MENU?: any;
    CREDOR?: any;
    CREDOR_SELECIONADO?: any;
    CREDOR_DIVIDAS?: any;
    OFERTA?: any;
    PROMESSAS?: any;
    BOLETO?: any;
  };
}

interface CredorData {
  iddevedor: number;
  cpfcnpj: string;
  nome: string;
  telefone: string;
  idtelefones: number;
  idusuario: number;
}

interface ConnectedUser {
  ticketId: TicketId;
}

class StateMachine {
  // Armazena todas as máquinas de estado
  static stateMachines: Record<string, StateMachine> = {};
  userStates: Record<PhoneNumber, UserState>;
  globalData: Record<string, any>;
  connectedUsers: Record<PhoneNumber, ConnectedUser>;
  timer: Record<string, any>;
  ticketId: TicketId;
  fromNumber: any;
  toNumber: any;
  sessionName: string;
  private whatsappService: WhatsAppService;

  constructor(sessionName: string, whatsappService: WhatsAppService) {
    this.userStates = {};
    this.globalData = {};
    this.connectedUsers = {};
    this.timer = {};
    this.ticketId = null;
    this.fromNumber = null;
    this.toNumber = null;
    this.sessionName = sessionName;
    this.whatsappService = whatsappService;

    // Registra no stateMachines da própria classe
    StateMachine.stateMachines[sessionName] = this;
    Logger.success(
      `StateMachine criada e registrada para a sessão: ${sessionName}`
    );
  }

  // Método para acessar uma máquina de estado por sessão
  static getStateMachine(sessionName: string | number) {
    return StateMachine.stateMachines[String(sessionName)] || null;
  }

  // Método para deletar uma máquina de estado por sessão
  static deleteStateMachine(sessionName: string | number) {
    const key = String(sessionName);
    if (StateMachine.stateMachines[key]) {
      delete StateMachine.stateMachines[key];
      Logger.info(`StateMachine removida para a sessão: ${sessionName}`);
    } else {
      Logger.warn(
        `Nenhuma StateMachine encontrada para a sessão: ${sessionName}`
      );
    }
  }

  // Método para listar todas as máquinas de estado
  static listStateMachines() {
    return Object.keys(StateMachine.stateMachines);
  }

  // Métodos adicionais para a lógica interna da máquina de estado
  getState() {
    return `Estado atual da sessão ${this.sessionName}`;
  }

  _setConnectedUsers(phoneNumber: PhoneNumber, ticketId: TicketId): void {
    if (this.connectedUsers && this.connectedUsers[phoneNumber]) {
      this.connectedUsers = {
        ...this.connectedUsers,
        [phoneNumber]: {
          ticketId: ticketId,
        },
      };
    } else {
      this.connectedUsers[phoneNumber] = {
        ticketId,
      };
    }
  }

  async setTicketId(ticketId: TicketId): Promise<void> {
    this.ticketId = ticketId;
  }

  async setFromNumber(from: string): Promise<void> {
    this.fromNumber = from;
  }

  async setToNumber(to: string): Promise<void> {
    this.toNumber = to;
  }

  async getCredorFromDB(phoneNumber: PhoneNumber): Promise<CredorData | null> {
    try {
      if (!this.userStates[phoneNumber]) {
        this.userStates[phoneNumber] = {} as UserState; // Inicialize o objeto se não existir
      }

      const query = `
        select
          d.iddevedor,
          d.cpfcnpj,
          d.nome,
          t.telefone,
          t.idtelefones,
          d.idusuario
        from
          statustelefone s,
          telefones2 t,
          devedor d ,
          credor c
        where
          right(t.telefone,8) = '${phoneNumber}'
          and d.cpfcnpj = t.cpfcnpj
          and d.idusuario not in (11, 14)
          and s.idstatustelefone = t.idstatustelefone
          and s.fila = 's'
          and c.idcredor = d.idcredor
          and c.libera_api_acordo = 's'
      `;

      const dbResponse = await executeQuery(query);

      if (Array.isArray(dbResponse) && dbResponse.length) {
        for (const credor of dbResponse as CredorData[]) {
          const liberaApiQuery = `select libera_api(${credor.iddevedor}) as liberaApi;`;
          const liberaApiResponse = await executeQuery(liberaApiQuery);

          // Se o liberaApiResponse retornar 'S' retorne o primeiro credor
          if (
            Array.isArray(liberaApiResponse) &&
            liberaApiResponse.length &&
            (liberaApiResponse[0] as any).liberaApi === "S"
          ) {
            Logger.info(`Libera API encontrada para o número ${phoneNumber}.`);
            this._setCredor(phoneNumber, dbResponse[0] as CredorData);
            return dbResponse[0] as CredorData;
          }
        }

        // Se nenhum valor de liberaApi for encontrado, retorna null
        Logger.warn(
          `Nenhuma liberação de API encontrada para o número ${phoneNumber}.`
        );
        return null;
      } else {
        Logger.warn(`Nenhum credor encontrado para o número ${phoneNumber}.`);
        return null;
      }
    } catch (error) {
      console.error(
        `Erro ao buscar credor para o número ${phoneNumber}:`,
        error
      );
      throw error;
    }
  }

  _setDataMenu(phoneNumber: PhoneNumber, data: any): void {
    this.userStates[phoneNumber].data!.MENU = data;
  }

  _setDataCredores(phoneNumber: PhoneNumber, data: any[]): void {
    if (!this.userStates[phoneNumber].data) {
      this.userStates[phoneNumber].data = {}; // Inicializa o objeto se não existir
    }
    this.userStates[phoneNumber].data!.CREDOR = data;
  }

  _setDataCredorSelecionado(phoneNumber: PhoneNumber, data: any): void {
    // Verifica se o objeto userStates existe para o número de telefone
    if (!this.userStates[phoneNumber]) {
      this.userStates[phoneNumber] = {} as UserState; // Inicializa o objeto se estiver indefinido
    }

    // Verifica se o objeto data existe dentro de userStates[phoneNumber]
    if (!this.userStates[phoneNumber].data) {
      this.userStates[phoneNumber].data = {}; // Inicializa o objeto data se estiver indefinido
    }

    // Agora é seguro definir a propriedade CREDOR_SELECIONADO
    this.userStates[phoneNumber].data!.CREDOR_SELECIONADO = data;
  }

  _setDataCredorDividas(phoneNumber: PhoneNumber, data: unknown): void {
    this.userStates[phoneNumber].data!.CREDOR_DIVIDAS = data;
  }

  _setDataOferta(phoneNumber: PhoneNumber, data: any): void {
    this.userStates[phoneNumber].data!.OFERTA = data;
  }

  _setDataPromessas(
    phoneNumber: PhoneNumber,
    data: {
      promessas: any;
      ultimaDataVencimento: any;
      vencimentosParcelas: any;
    }
  ): void {
    this.userStates[phoneNumber].data!.PROMESSAS = data;
  }

  _setDataBoleto(
    phoneNumber: PhoneNumber,
    data:
      | {
          idcredor: any;
          cpfcnpj: any;
          comissao_comercial: any;
          idcomercial: any;
          idgerente_comercial: any;
          iddevedor: any;
          plano: any;
          total_geral: any;
          valor_parcela: any;
          tarifa_boleto: any;
          ultimoIdAcordo: string;
          dataacordo: string;
        }
      | undefined
  ): void {
    this.userStates[phoneNumber].data!.BOLETO = data;
  }

  _setCredor(phoneNumber: PhoneNumber, credor: CredorData): void {
    this.userStates[phoneNumber].credor = credor;
  }

  _setCurrentState(phoneNumber: PhoneNumber, newState: string): void {
    if (!this.userStates[phoneNumber]) {
      this.userStates[phoneNumber] = { currentState: "INICIO" } as UserState;
    }

    Logger.info("Estado anterior:", this.userStates[phoneNumber].currentState);
    Logger.info("SALVANDO NOVO ESTADO...", newState);
    this.userStates[phoneNumber].currentState = newState;
    Logger.info(
      "Estado atualizado:",
      this.userStates[phoneNumber].currentState
    );
  }

  _getCredor(phoneNumber: PhoneNumber): CredorData | undefined {
    return this.userStates[phoneNumber].credor;
  }

  _getState(phoneNumber: PhoneNumber): UserState {
    if (this.userStates[phoneNumber]) {
      return this.userStates[phoneNumber];
    }

    this.userStates[phoneNumber] = {
      currentState: "INICIO",
      credor: undefined,
      data: {
        CREDOR: {},
        OFERTA: {},
      },
    };

    return this.userStates[phoneNumber];
  }

  _resetUserState(phoneNumber: PhoneNumber): void {
    delete this.userStates[phoneNumber];
  }

  async _postMessage(
    connectionId: string,
    body:
      | string
      | {
          type: "image" | "document" | "video" | "audio";
          mediaUrl: string;
          caption?: string;
        }
  ): Promise<void> {
    Logger.info(`Horário da mensagem ENVIADA ao cliente: ${new Date()}`);

    const demim = 1;

    try {
      if (!this.fromNumber || !this.toNumber) {
        throw new Error("Números de origem ou destino não definidos.");
      }

      if (typeof body === "string") {
        await this.getRegisterMessagesDB(
          this.toNumber,
          this.fromNumber,
          body,
          this.ticketId,
          demim
        );

        await this.whatsappService.sendMessage(connectionId, this.toNumber, {
          text: body,
        });

        Logger.info(
          `Mensagem de texto enviada de ${this.fromNumber} para ${this.toNumber}:`,
          body
        );
      } else {
        await this.whatsappService.sendMessage(connectionId, this.toNumber, {
          type: body.type,
          mediaUrl: body.mediaUrl,
          caption: body.caption,
        });

        Logger.info(
          `Mensagem de mídia enviada de ${this.fromNumber} para ${this.toNumber}:`,
          body
        );
      }
    } catch (error) {
      console.error("Erro ao enviar mensagem:", error);
    }
  }

  async _getTicketStatusDB(phoneNumber: PhoneNumber): Promise<any> {
    if (!this.userStates[phoneNumber]) {
      this.userStates[phoneNumber] = {} as UserState; // inicialize o objeto se não existir
    }

    const dbQuery = `
    select
      bt.id,
      bot_idstatus,
      bot_contato_id,
      idresponsavel,
      bt.inclusao,
      encerrado
    from
      bot_ticket bt,
      bot_contato bc
    where
      bc.telefone = ${phoneNumber}
      and bc.id = bt.bot_contato_id
    `;

    const dbResponse = await executeQuery(dbQuery);

    return dbResponse;
  }

  async _getInsertClientNumberDB(phoneNumber: PhoneNumber): Promise<any> {
    if (!this.userStates[phoneNumber]) {
      this.userStates[phoneNumber] = {} as UserState; // inicialize o objeto se não existir
    }

    const dbQuery = `
    INSERT ignore INTO
      cobrance.bot_contato (
        telefone
      ) 
    VALUES(
      ${phoneNumber}
    )`;

    const dbResponse = await executeQuery(dbQuery);

    return dbResponse;
  }

  async _getInsertTicketDB(phoneNumber: PhoneNumber): Promise<any> {
    if (!this.userStates[phoneNumber]) {
      this.userStates[phoneNumber] = {} as UserState; // inicialize o objeto se não existir
    }

    const dbQuery = `
    insert into
      bot_ticket (
        bot_idstatus,
        bot_contato_id,
        idresponsavel
    )
    values(
      1,
      (select id from bot_contato bc where telefone =${phoneNumber}),
      1
    )`;

    const dbResponse = await executeQuery(dbQuery);

    return dbResponse;
  }

  async getRegisterMessagesDB(
    from: string,
    to: string,
    message: string,
    ticketId: TicketId,
    demim: number
  ): Promise<any> {
    if (!this.userStates[from]) {
      this.userStates[from] = {} as UserState; // inicialize o objeto se não existir
    }

    const formatDateTime = utils.getCurrentDateTime();
    const formatFromNumber = formatPhoneNumber(from);
    const formatToNumber = formatPhoneNumber(to);

    const dbQuery = `
      INSERT INTO
      bot_mensagens(
        de,
        para,
        mensagem,
        data_hora,
        bot_ticket_id,
        demim
      )
      values(
        '${formatFromNumber}',
        '${formatToNumber}',
        '${message}',
        '${formatDateTime}',
        '${ticketId}',
        '${demim}'
      )
    `;

    const dbResponse = await executeQuery(dbQuery);

    return dbResponse;
  }

  async _getWhaticketStatus(phoneNumber: PhoneNumber): Promise<any[]> {
    const dbQuery = `
    SELECT DISTINCT c.*, t.*,
    (SELECT m.fromMe FROM Messages m WHERE m.ticketId = t.id ORDER BY m.createdAt DESC LIMIT 1) AS fromMe,
    (SELECT m.body FROM Messages m WHERE m.ticketId = t.id ORDER BY m.createdAt DESC LIMIT 1) AS body
    FROM Tickets t
    LEFT JOIN Contacts c ON c.id = t.contactId
    WHERE status = 'pending' AND LENGTH(c.number) <= 15 AND c.number = '${phoneNumber}'
    HAVING fromMe = 0;
    `;

    const dbResponse = await executeQuery(dbQuery);

    if (Array.isArray(dbResponse) && dbResponse.length) {
      return dbResponse;
    }

    throw new Error("Something não encontrado");
  }

  async _handleErrorState(
    origin: string,
    phoneNumber: PhoneNumber,
    errorMessage: string
  ): Promise<void> {
    await this._postMessage(origin, errorMessage);
    await this._resetUserState(phoneNumber);
    await this._handleInitialState(origin, phoneNumber);
  }

  async _handleInitialState(
    origin: string,
    phoneNumber: PhoneNumber
  ): Promise<void> {
    const credor = await this.getCredorFromDB(phoneNumber);

    if (!credor || (Array.isArray(credor) && credor.length === 0)) {
      Logger.warn(
        "Credor sem cadastro no banco de dados. Atendimento chatbot não iniciado para -",
        phoneNumber
      );
      return;
    }

    const message = `Olá *${credor.nome}*,\n\nPor favor, escolha uma opção:\n\n*1)* Ver Dívidas\n*2)* Ver Acordos\n*3)* Linha Digitável\n*4)* Pix Copia e Cola`;
    await this._postMessage(origin, message);
  }

  async _handleMenuState(
    origin: string,
    phoneNumber: PhoneNumber,
    response: { body: string }
  ): Promise<void> {
    const initialStateResponse = response.body.trim();
    switch (initialStateResponse) {
      case "1":
        try {
          const credor = this._getCredor(phoneNumber);
          if (!credor) return;

          const { cpfcnpj: document } = credor;
          const credorInfo = await requests.getCredorInfo(document);

          if (
            !credorInfo ||
            !Array.isArray(credorInfo) ||
            credorInfo.length === 0
          ) {
            const messageErro =
              "Você não possui dívidas ou ofertas disponíveis.";

            await this._postMessage(origin, messageErro);
            await this._handleInitialState(origin, phoneNumber);
          } else if (credorInfo && credorInfo.length === 1) {
            const credorMessage = utils.formatCredorInfo(credorInfo);
            const messageSucess = `${credorMessage}`;

            await this._postMessage(origin, messageSucess);
            this._setCurrentState(phoneNumber, "CREDOR");
            await this._handleCredorState(origin, phoneNumber, response);
          } else {
            const credorMessage = utils.formatCredorInfo(credorInfo);
            const messageSucess = `${credorMessage}\n\n_Selecione o numero da divida a negociar._`;

            await this._postMessage(origin, messageSucess);
            this._setCurrentState(phoneNumber, "CREDOR");
          }
        } catch (error) {
          console.error("Case 1 retornou um erro - ", (error as Error).message);
          await this._handleErrorState(
            origin,
            phoneNumber,
            "Ocorreu um erro ao processar sua solicitação. Por favor, tente novamente."
          );
        }
        break;

      case "2":
        try {
          await this._handleAcordoState(origin, phoneNumber);
        } catch (error) {
          console.error("Case 2 retornou um erro - ", (error as Error).message);
          await this._handleErrorState(
            origin,
            phoneNumber,
            "Ocorreu um erro ao processar sua solicitação. Por favor, tente novamente."
          );
        }
        break;

      case "3":
        try {
          await this._handleBoletoState(origin, phoneNumber, response);
        } catch (error) {
          console.error("Case 3 retornou um erro - ", (error as Error).message);
          await this._handleErrorState(
            origin,
            phoneNumber,
            "Ocorreu um erro ao processar sua solicitação. Por favor, tente novamente."
          );
        }
        break;

      case "4":
        try {
          await this._handlePixState(origin, phoneNumber, response);
        } catch (error) {
          console.error("Case 4 retornou um erro - ", (error as Error).message);
          await this._handleErrorState(
            origin,
            phoneNumber,
            "Ocorreu um erro ao processar sua solicitação. Por favor, tente novamente."
          );
        }
        break;
    }
  }

  async _handleCredorState(
    origin: string,
    phoneNumber: PhoneNumber,
    response: { body: string }
  ): Promise<void> {
    try {
      const credor = this._getCredor(phoneNumber);
      if (!credor) return;

      const { cpfcnpj: document } = credor;
      const credorInfo = await requests.getCredorInfo(document);

      if (Array.isArray(credorInfo) && credorInfo.length > 0) {
        let selectedCreditor;

        if (credorInfo.length === 1) {
          selectedCreditor = credorInfo[0];
        } else if (credorInfo.length > 1) {
          const selectedOption = parseInt(response.body.trim());
          this._setDataCredores(phoneNumber, credorInfo);

          if (selectedOption >= 1 && selectedOption <= credorInfo.length) {
            selectedCreditor = credorInfo[selectedOption - 1];
          } else {
            await this._postMessage(
              origin,
              "Resposta inválida. Por favor, tente novamente."
            );
            return;
          }
        }

        if (selectedCreditor) {
          this._setDataCredorSelecionado(phoneNumber, selectedCreditor);

          const idDevedor = selectedCreditor.iddevedor;
          const dataBase = utils.getCurrentDate();

          const [credorDividas, credorOfertas] = await Promise.all([
            requests.getCredorDividas(idDevedor, dataBase),
            requests.getCredorOfertas(idDevedor),
          ]);

          this._setDataCredorDividas(phoneNumber, credorDividas);

          const formattedResponseDividas = utils.formatCredorDividas(
            credorDividas as any[]
          );
          const formattedResponseOfertas = utils.formatCredorOfertas(
            credorOfertas as any[]
          );

          const terceiraMensagem = `As seguintes dívidas foram encontradas para a empresa selecionada:\n\n${formattedResponseDividas}\n\n*Escolha uma das opções abaixo para prosseguirmos no seu acordo:*\n\n${formattedResponseOfertas}`;

          await this._postMessage(origin, terceiraMensagem);
          this._setCurrentState(phoneNumber, "OFERTA");
        }
      } else {
        await this._postMessage(
          origin,
          "Não foi possível encontrar informações para o documento fornecido."
        );
      }
    } catch (error) {
      console.error("Erro ao lidar com o estado do credor:", error);
      await this._postMessage(
        origin,
        "Ocorreu um erro ao processar sua solicitação. Tente novamente mais tarde."
      );
    }
  }

  async _handleOfertaState(
    origin: string,
    phoneNumber: PhoneNumber,
    response: { body: string }
  ): Promise<void> {
    try {
      if (response && response.body.trim().match(/^\d+$/)) {
        const selectedOptionParcelamento = parseInt(response.body.trim());

        const credorByPhone = await requests.getCredorByPhoneNumber(
          phoneNumber
        );

        if (!Array.isArray(credorByPhone) || credorByPhone.length === 0) {
          await this._postMessage(
            origin,
            "Erro ao processar sua solicitação. Por favor, tente novamente."
          );
          return;
        }

        const { cpfcnpj } = credorByPhone[0];
        const credorInfo = await requests.getCredorInfo(cpfcnpj);

        if (!Array.isArray(credorInfo) || credorInfo.length === 0) {
          await this._postMessage(
            origin,
            "Erro ao processar sua solicitação. Por favor, tente novamente."
          );
          return;
        }

        const {
          comissao_comercial,
          idcomercial,
          idgerente_comercial,
          iddevedor,
        } = credorInfo[0];

        const credorOfertas = await requests.getCredorOfertas(iddevedor);

        if (!Array.isArray(credorOfertas) || credorOfertas.length === 0) {
          await this._postMessage(
            origin,
            "Erro ao processar sua solicitação. Por favor, tente novamente."
          );
          return;
        }

        if (
          selectedOptionParcelamento >= 1 &&
          selectedOptionParcelamento <= credorOfertas.length
        ) {
          await this._postMessage(
            origin,
            "Aguarde, estamos gerando o seu acordo..."
          );

          const ofertaSelecionada =
            credorOfertas[selectedOptionParcelamento - 1];
          this._setDataOferta(phoneNumber, ofertaSelecionada);

          const { periodicidade, valor_parcela, plano, idcredor, total_geral } =
            ofertaSelecionada;

          const ultimaDataParcela = utils.getUltimaDataParcela(
            periodicidade,
            valor_parcela,
            plano
          );

          if (!ultimaDataParcela) {
            await this._postMessage(
              origin,
              "Erro ao processar sua solicitação. Por favor, tente novamente."
            );
            return;
          }

          const { parcelasArray, ultimaData } = ultimaDataParcela;
          const ultimaDataFormat = ultimaData.toISOString().slice(0, 10);

          const currentDate = new Date();
          const currentTime = utils.getCurrentTime();

          const newDataBase =
            currentDate.getDate() + parseInt(plano) * periodicidade;
          const formattedDate = newDataBase.toString().substring(0, 10);

          const response = await requests.getCredorDividas(
            iddevedor,
            formattedDate
          );
          const { data: promessas } = response as { data: any };

          const obj = {
            promessas,
            ultimaDataVencimento: ultimaData.toISOString().slice(0, 10),
            vencimentosParcelas: parcelasArray,
          };

          this._setDataPromessas(phoneNumber, obj);

          const responseDividasCredores = (await requests.getCredorDividas(
            iddevedor,
            ultimaDataFormat
          )) as any[];

          const responseDividasCredoresTotais =
            await requests.getCredorDividasTotais(iddevedor, ultimaDataFormat);

          const {
            juros_percentual,
            honorarios_percentual,
            multa_percentual,
            tarifa_boleto,
          } = responseDividasCredoresTotais as {
            juros_percentual: any;
            honorarios_percentual: any;
            multa_percentual: any;
            tarifa_boleto: any;
          };

          const parsedData = utils.parseDadosAcordo({
            currentTime,
            honorarios_percentual,
            idcredor,
            iddevedor: iddevedor,
            juros_percentual,
            multa_percentual,
            plano,
            responseDividasCredores,
            tarifa_boleto,
            total_geral,
            ultimaDataVencimento: ultimaDataFormat,
          });

          const idacordo = await requests.postDadosAcordo(parsedData);

          const parsedData2 = utils.parseDadosPromessa({
            idacordo,
            iddevedor: iddevedor,
            plano,
          });

          let contratos = "";
          const contratosIncluidos = new Set();

          responseDividasCredores.forEach(
            (dividas: { contrato: any }, index: number) => {
              const { contrato } = dividas;

              // Verifica se o contrato já foi incluído na lista.
              if (!contratosIncluidos.has(contrato)) {
                contratos += contrato;
                contratosIncluidos.add(contrato); // Adiciona o contrato ao Set.

                // Verifica se não é o último contrato antes de adicionar a barra "/".
                if (index !== responseDividasCredores.length - 1) {
                  contratos += " / ";
                }
              }
            }
          );

          const contratosDividas = contratos;

          const promises: Promise<any>[] = [];
          let parcelaNumber = 0;

          for (const parcela of parcelasArray) {
            parcelaNumber += 1;

            const dataPromessa = {
              ...parsedData2,
              data: parcela.vencimento.toISOString().slice(0, 10),
              valor: parseFloat(parcela.valorParcelaAtual),
              parcela: parcelaNumber,
            };

            dataPromessa.mensagem = `Parcela(s) ${parcelaNumber}/${plano} de acordo referente ao(s) título(s): ${contratos}
      Sr(a). Caixa:
      Não receber após o vencimento.
      Não receber valor inferior ao valor facial deste boleto, sem autorização do cedente.
      Sr (a). Cliente:
      A utilização deste boleto é obrigatória para adequada confirmação do pagamento.
      Depósito na conta corrente, sem a devida autorização do cedente, não garante a quitação do débito.
      `;

            const promise = requests.postDadosPromessa(dataPromessa);
            promises.push(promise);
          }

          const responsePromessas = await Promise.all(promises);

          const [ultimoIdPromessa] = responsePromessas.slice(-1);

          const credorInfoData = credorInfo[0];
          const { chave, empresa } = credorInfoData;
          const { percentual_comissao_cobrador, idoperacao, idempresa } =
            responseDividasCredores[0];

          const parsedData3 = utils.parseDadosRecibo({
            comissao_comercial,
            cpfcnpj: cpfcnpj,
            honorarios_percentual,
            idacordo,
            iddevedor,
            idcredor,
            idcomercial,
            idgerente_comercial,
            juros_percentual,
            plano,
            ultimaDataVencimento: ultimaDataFormat,
            chave,
            empresa,
            percentual_comissao_cobrador,
            idoperacao,
            idempresa,
          });

          const responseRecibo = await requests.postDadosRecibo(parsedData3);

          if (
            responseRecibo &&
            Object.prototype.hasOwnProperty.call(responseRecibo, "error")
          ) {
            console.error((responseRecibo as any).error);
            throw new Error("Erro ao receber responseRecibo.");
          }

          await requests.getAtualizarPromessas(idacordo);
          await requests.getAtualizarValores(idacordo);

          const responseBoleto = await requests.postBoletoFinal(
            credorInfo,
            String(idacordo),
            contratosDividas,
            iddevedor,
            idcredor,
            plano,
            total_geral,
            valor_parcela,
            comissao_comercial,
            idcomercial,
            idgerente_comercial,
            tarifa_boleto
          );

          this._setDataBoleto(phoneNumber, responseBoleto);

          const responseIdBoleto = await requests.getIdBoleto(idacordo);

          const { idboleto } = (responseIdBoleto as any[])[0];
          const { banco } = (responseIdBoleto as any[])[0];
          const { convenio } = (responseIdBoleto as any[])[0];

          const updateValoresBoleto = await requests.postAtualizarValores({
            idboleto,
            banco,
            convenio,
          });

          if (
            updateValoresBoleto &&
            Object.prototype.hasOwnProperty.call(updateValoresBoleto, "error")
          ) {
            console.error("Erro ao atualizar valores de nossoNum e numDoc: ", {
              updateValoresBoleto,
            });
            throw new Error("Erro ao atualizar valores de nossoNum e numDoc.");
          }

          const parsedData4 = utils.parseDadosImagemBoleto({
            idacordo,
            idboleto,
            banco,
          });
          const responseBoletoContent = await requests.getImagemBoleto(
            parsedData4
          );

          const parsedData5 = utils.parseDadosImagemQrCode({ idboleto });
          const responseQrcodeContent = await requests.getImagemQrCode(
            parsedData5
          );

          if (!responseBoletoContent && !responseQrcodeContent) {
            console.error(
              "Erro ao executar responseBoletoContent ou responseQrcodeContent."
            );
            throw new Error(
              "Erro ao executar responseBoletoContent ou responseQrcodeContent."
            );
          }

          await utils.saveQRCodeImageToLocal(
            (responseQrcodeContent as any).url,
            idboleto
          );

          // Verifica se a imagem foi salva corretamente
          const imagePath = path.resolve("src", "qrcodes", `${idboleto}.png`);
          const imageExists = await utils.checkIfFileExists(imagePath);

          Logger.info("A imagem foi salva corretamente:", imageExists);

          if (!imageExists) {
            throw new Error("QR Code não encontrado no diretório local");
          }

          const mensagemAcordo = `*ACORDO REALIZADO COM SUCESSO!*\n\nPague a primeira parcela através do QRCODE ou link do BOLETO abaixo:\n\nhttp://cobrance.com.br/acordo/boleto.php?idboleto=${idboleto}&email=2`;
          const mensagemRecibo =
            "*ATENÇÃO! CONFIRA SEUS DADOS E VALOR NA HORA DO PAGAMENTO!*\n\nPor favor, nos envie o *comprovante* assim que possivel para registro! Atendimento finalizado, obrigado e bons negócios.";

          try {
            await this._postMessage(origin, mensagemAcordo);
            await this._postMessage(origin, {
              type: "image",
              mediaUrl: imagePath,
              caption: "QR Code para pagamento do boleto",
            });
            await this._postMessage(origin, mensagemRecibo);

            const date = new Date();
            const formattedDateTime = utils.getBrazilTimeFormatted(date);

            Logger.success(
              `ACORDO FECHADO! IdDevedor - ${iddevedor} IdAcordo - ${idacordo} para o nº ${phoneNumber} em ${formattedDateTime}`
            );

            await requests.getFecharAtendimentoHumano(this.ticketId);
          } catch (error) {
            console.error(
              "Erro ao enviar as mensagens: mensagemAcordo, media e mensagemRecibo",
              error
            );
          }
        } else {
          // Resposta inválida, informar o usuário
          await this._postMessage(
            origin,
            "Resposta inválida. Por favor, escolha uma opção válida."
          );
          this._setCurrentState(phoneNumber, "OFERTA"); // Mantém o estado OFERTA
        }
      } else {
        // Resposta não numérica, informar o usuário
        await this._postMessage(
          origin,
          "Resposta inválida. Por favor, escolha uma opção válida."
        );
        this._setCurrentState(phoneNumber, "OFERTA"); // Mantém o estado OFERTA
      }
    } catch (error) {
      console.error("Erro ao lidar com o estado de oferta:", error);
    }
  }

  async _handleAcordoState(
    origin: string,
    phoneNumber: PhoneNumber
  ): Promise<void> {
    try {
      const credorData = await this.getCredorFromDB(phoneNumber);
      if (!credorData) return;

      const { cpfcnpj: document } = credorData;

      const acordosFirmados = await requests.getAcordosFirmados(document);

      if (
        !acordosFirmados ||
        !Array.isArray(acordosFirmados) ||
        acordosFirmados.length === 0
      ) {
        const message = "Você não possui acordos efetuados a listar.";
        await this._postMessage(origin, message);
        await this._handleInitialState(origin, phoneNumber);
      } else {
        const formatAcordos = utils.formatCredorAcordos(acordosFirmados);

        const message = `*Os seguintes acordos firmados foram encontrados:*\n\n${formatAcordos}`;
        await this._postMessage(origin, message);
        await this._handleInitialState(origin, phoneNumber);
      }
    } catch (error) {
      console.error("Case 2 retornou um erro - ", (error as Error).message);
      await this._handleErrorState(
        origin,
        phoneNumber,
        "Ocorreu um erro ao processar sua solicitação. Por favor, tente novamente."
      );
    }
  }

  async _handleBoletoState(
    origin: string,
    phoneNumber: PhoneNumber,
    response: { body: string }
  ): Promise<void> {
    try {
      const credorData = await this.getCredorFromDB(phoneNumber);
      if (!credorData) return;

      const { cpfcnpj: document } = credorData;

      const acordosFirmados = await requests.getAcordosFirmados(document);

      if (
        !acordosFirmados ||
        !Array.isArray(acordosFirmados) ||
        acordosFirmados.length === 0
      ) {
        const message =
          "Você não possui acordos nem Linhas Digitáveis a listar.";
        await this._postMessage(origin, message);
        await this._handleInitialState(origin, phoneNumber);
      } else {
        const responseBoletoPixArray = [];

        for (const acordo of acordosFirmados) {
          const iddevedor = acordo.iddevedor;

          try {
            const responseBoletoPix = await requests.getDataBoletoPix(
              iddevedor
            );
            responseBoletoPixArray.push(responseBoletoPix);
            Logger.info(
              `responseBoletoPix executado para ${iddevedor} com resposta ${responseBoletoPix}`
            );
          } catch (error) {
            console.error(
              "Erro ao obter dados do boleto para iddevedor",
              iddevedor,
              ":",
              (error as Error).message
            );
            await this._handleErrorState(
              origin,
              phoneNumber,
              "Ocorreu um erro ao processar sua solicitação. Por favor, tente novamente."
            );
            return;
          }
        }

        if (acordosFirmados.length > 0 && responseBoletoPixArray.length === 0) {
          await this._postMessage(origin, "Boleto vencido ou não disponível.");
          await this._handleInitialState(origin, phoneNumber);
        } else if (
          responseBoletoPixArray.length === 1 &&
          Array.isArray(responseBoletoPixArray[0]) &&
          responseBoletoPixArray[0].length === 0
        ) {
          await this._postMessage(origin, "Boleto vencido ou não disponível.");
          await this._handleInitialState(origin, phoneNumber);
        } else {
          const formatBoletoPixArray = utils.formatCodigoBoleto(
            responseBoletoPixArray
          );
          const message = `${formatBoletoPixArray}`;
          await this._postMessage(origin, message);
          await this._handleInitialState(origin, phoneNumber);
        }
      }
    } catch (error) {
      console.error("Case 3 retornou um erro - ", (error as Error).message);
      await this._handleErrorState(
        origin,
        phoneNumber,
        "Ocorreu um erro ao processar sua solicitação. Por favor, tente novamente."
      );
    }
  }

  async _handlePixState(
    origin: string,
    phoneNumber: PhoneNumber,
    response: { body: string }
  ): Promise<void> {
    try {
      const credorData = await this.getCredorFromDB(phoneNumber);
      if (!credorData) return;

      const { cpfcnpj: document } = credorData;

      const acordosFirmados = await requests.getAcordosFirmados(document);

      if (
        !acordosFirmados ||
        !Array.isArray(acordosFirmados) ||
        acordosFirmados.length === 0
      ) {
        const message = "Você não possui acordos nem Códigos PIX a listar.";
        await this._postMessage(origin, message);
        await this._handleInitialState(origin, phoneNumber);
      } else {
        const responseBoletoPixArray = [];

        for (const acordo of acordosFirmados) {
          const iddevedor = acordo.iddevedor;

          try {
            const responseBoletoPix = await requests.getDataBoletoPix(
              iddevedor
            );
            responseBoletoPixArray.push(responseBoletoPix);
            Logger.info(
              `responseBoletoPix executado para ${iddevedor} com resposta ${responseBoletoPix}`
            );
          } catch (error) {
            console.error(
              "Erro ao obter dados do boleto para iddevedor",
              iddevedor,
              ":",
              (error as Error).message
            );
            await this._handleErrorState(
              origin,
              phoneNumber,
              "Ocorreu um erro ao processar sua solicitação. Por favor, tente novamente."
            );
            return;
          }
        }

        // Verificar se acordosFirmados tem dados e responseBoletoPixArray está vazio ou indefinido
        if (acordosFirmados.length > 0 && responseBoletoPixArray.length === 0) {
          await this._postMessage(
            origin,
            "Código PIX vencido ou não disponível."
          );
          await this._handleInitialState(origin, phoneNumber);
        } else if (
          responseBoletoPixArray.length === 1 &&
          Array.isArray(responseBoletoPixArray[0]) &&
          responseBoletoPixArray[0].length === 0
        ) {
          await this._postMessage(
            origin,
            "Código PIX vencido ou não disponível."
          );
          await this._handleInitialState(origin, phoneNumber);
        } else {
          const formatBoletoPixArray = utils.formatCodigoPix(
            responseBoletoPixArray
          );

          const message = `${formatBoletoPixArray}`;
          await this._postMessage(origin, message);
          await this._handleInitialState(origin, phoneNumber);
        }
      }
    } catch (error) {
      console.error("Case 4 retornou um erro - ", (error as Error).message);
      await this._handleErrorState(
        origin,
        phoneNumber,
        "Ocorreu um erro ao processar sua solicitação. Por favor, tente novamente."
      );
    }
  }

  async handleMessage(
    phoneNumber: PhoneNumber,
    response: { from: string }
  ): Promise<void> {
    try {
      let { currentState } = this._getState(phoneNumber);
      const origin = response.from;

      if (!currentState) {
        currentState = "INICIO";
      }

      Logger.info(
        `[Sessão: ${this.sessionName} - Número: ${phoneNumber} - Estado: ${currentState}]`
      );

      switch (currentState) {
        case "INICIO":
          await this._handleInitialState(origin, phoneNumber);
          this._setCurrentState(phoneNumber, "MENU");
          break;
        case "MENU":
          await this._handleMenuState(origin, phoneNumber, response as any);
          break;
        case "CREDOR":
          await this._handleCredorState(origin, phoneNumber, response as any);
          this._setCurrentState(phoneNumber, "OFERTA");
          break;
        case "OFERTA":
          await this._handleOfertaState(origin, phoneNumber, response as any);
          this._setCurrentState(phoneNumber, "INICIO");
          break;
        case "VER_ACORDOS":
          await this._handleAcordoState(origin, phoneNumber);
          this._setCurrentState(phoneNumber, "INICIO");
          break;
        case "VER_LINHA_DIGITAVEL":
          await this._handleBoletoState(origin, phoneNumber, response as any);
          this._setCurrentState(phoneNumber, "INICIO");
          break;
        case "VER_CODIGO_PIX":
          await this._handlePixState(origin, phoneNumber, response as any);
          this._setCurrentState(phoneNumber, "INICIO");
          break;
      }
    } catch (error) {
      if (
        (error as Error).message.includes("Nao existe atendimento registrado")
      ) {
        console.error("Erro ao criar um novo ticket:", error);
      } else {
        console.error("Erro ao verificar o status do serviço:", error);
      }
    }
  }
}

export default StateMachine;
