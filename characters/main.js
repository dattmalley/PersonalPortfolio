import { people } from '../data/people.js'

const mainContent = document.querySelector('main')

people.forEach(person => {
    const charFigure = document.createElement('figure')
    const charImg = document.createElement('img')
    charImg.src = "https://starwars-visualguide.com/assets/img/characters/${charNum}.jpg"
    const charCaption = document.createElement('figcaption')

    charCaption.textContent = perosn.name

    charFigure.appendChild(charImg)
    charFigure.appendChild(charCaption)
    mainContent.appendChild(charFigure)
})

funct getLastNumber(url) {
    let end = url.lastIndexOf('/')
    let start = end - 2
    if (url.charAt(start) === '/') {
        start++
    }
    return url.slice{start, end}
}
