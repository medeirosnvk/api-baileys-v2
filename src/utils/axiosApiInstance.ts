import axios from "axios";

const baseURL = "https://api.cobrance.online:3030";

const axiosApiInstance = axios.create({ baseURL });

export default { axiosApiInstance };
