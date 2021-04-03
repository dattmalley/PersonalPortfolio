import { starships } from '../data/starships.js'

const main = document.querySelector('main')
const navList = document.querySelector('.navList')
const shipView = document.querySelector('.shipView')

function populateNav() {
    starships.forEach((starship) => {
        let listItem = document.createElement('li')
        listItem.textContent = starship.name

        navList.appendChild(listItem)
    })
}

function populateShipView(shipData) {
    let shipImage = document.createElement('img') 
    shipImage.src = `https://starwars-visualguide.com/assets/img/starships/15.jpg`
    shipView.appendChild(shipImage)
}

populateNav()
populateShipView()